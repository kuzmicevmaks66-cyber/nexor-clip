//! Запуск внешних инструментов (FFmpeg, ffprobe, whisper.cpp) без shell,
//! с построчным чтением вывода, отменой и событиями прогресса.

use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn command(bin: &str) -> Command {
    let mut c = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.stdin(Stdio::null());
    c
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn ffmpeg_bin(state: &AppState) -> String {
    non_empty(state.setting("ffmpeg_path").ok().flatten())
        .or_else(|| state.bundled("ffmpeg/ffmpeg.exe"))
        .unwrap_or_else(|| "ffmpeg".into())
}

pub fn ffprobe_bin(state: &AppState) -> String {
    if let Some(p) = non_empty(state.setting("ffprobe_path").ok().flatten()) {
        return p;
    }
    let ff = ffmpeg_bin(state);
    let p = Path::new(&ff);
    if p.parent().map(|d| !d.as_os_str().is_empty()).unwrap_or(false) {
        let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
        let cand = p.with_file_name(name);
        if cand.exists() {
            return cand.to_string_lossy().into_owned();
        }
    }
    "ffprobe".into()
}

/// Мажорная версия FFmpeg (None — git/nightly сборка, считаем её новой).
pub fn ffmpeg_major(state: &AppState) -> Option<u32> {
    let out = command(&ffmpeg_bin(state)).arg("-version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?;
    let ver = first.strip_prefix("ffmpeg version ")?;
    let digits: String = ver.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub job_id: String,
    pub stage: String,
    /// 0..1, либо -1 если прогресс неизвестен.
    pub progress: f64,
    pub message: String,
}

pub fn emit_progress(app: &AppHandle, job_id: &str, stage: &str, progress: f64, message: &str) {
    let _ = app.emit(
        "job-progress",
        JobProgress {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

fn pump<R: Read>(r: R, is_err: bool, tx: mpsc::Sender<(bool, String)>) {
    let mut reader = BufReader::new(r);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buf);
                for part in text.split('\r') {
                    let line = part.trim_end_matches('\n').trim();
                    if !line.is_empty() && tx.send((is_err, line.to_string())).is_err() {
                        return;
                    }
                }
            }
        }
    }
}

#[allow(dead_code)]
pub struct RunResult {
    pub stderr_tail: Vec<String>,
}

/// Запускает процесс, регистрирует его для отмены и передаёт каждую строку
/// вывода в `on_line(is_stderr, line)`. Ошибка — если код выхода не 0 или задача отменена.
pub fn run_tracked(
    state: &AppState,
    job_id: &str,
    mut cmd: Command,
    mut on_line: impl FnMut(bool, &str),
) -> AppResult<RunResult> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        AppError::msg(format!(
            "Не удалось запустить «{program}»: {e}. Проверьте путь в «Настройках»."
        ))
    })?;
    let out = child.stdout.take();
    let err = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(job_id.to_string(), child.clone());

    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let mut handles = Vec::new();
    if let Some(o) = out {
        let t = tx.clone();
        handles.push(thread::spawn(move || pump(o, false, t)));
    }
    if let Some(e) = err {
        let t = tx.clone();
        handles.push(thread::spawn(move || pump(e, true, t)));
    }
    drop(tx);

    let mut tail: VecDeque<String> = VecDeque::new();
    for (is_err, line) in rx {
        if is_err {
            tail.push_back(line.clone());
            if tail.len() > 60 {
                tail.pop_front();
            }
        }
        on_line(is_err, &line);
    }
    for h in handles {
        let _ = h.join();
    }
    let status = child.lock().unwrap_or_else(|e| e.into_inner()).wait()?;
    let was_registered = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(job_id)
        .is_some();
    if !was_registered {
        return Err(AppError::msg("Операция отменена"));
    }
    let tail: Vec<String> = tail.into_iter().collect();
    if !status.success() {
        return Err(AppError::msg(summarize_error(&program, &tail)));
    }
    Ok(RunResult { stderr_tail: tail })
}

/// Короткое понятное сообщение из хвоста stderr.
pub fn summarize_error(program: &str, tail: &[String]) -> String {
    let important: Vec<&String> = tail
        .iter()
        .filter(|l| {
            let l = l.to_lowercase();
            l.contains("error")
                || l.contains("invalid")
                || l.contains("no such file")
                || l.contains("not found")
                || l.contains("failed")
                || l.contains("unable")
                || l.contains("permission denied")
        })
        .collect();
    let lines: Vec<&String> = if important.is_empty() {
        tail.iter().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect()
    } else {
        important.into_iter().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect()
    };
    let name = Path::new(program)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.to_string());
    let body = lines.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n");
    if body.is_empty() {
        format!("{name} завершился с ошибкой")
    } else {
        format!("{name} завершился с ошибкой:\n{body}")
    }
}

/// Отмена задачи: процесс убивается, а HTTP-загрузки видят флаг отмены.
pub fn cancel(state: &AppState, job_id: &str) {
    state
        .cancels
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(job_id.to_string());
    let child = state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(job_id);
    if let Some(c) = child {
        let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
}

pub fn is_cancelled(state: &AppState, job_id: &str) -> bool {
    state
        .cancels
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(job_id)
}

pub fn clear_cancel(state: &AppState, job_id: &str) {
    state
        .cancels
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(job_id);
}

/// Форматирует секунды для аргументов FFmpeg.
pub fn secs(v: f64) -> String {
    format!("{:.3}", v.max(0.0))
}
