//! Распознавание речи через whisper.cpp (локально, без интернета).
//! Звук для распознавания берётся из того же монтажа, что и экспорт,
//! поэтому тайминги субтитров совпадают с Timeline.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::render::{self, Mode, RenderSpec};
use crate::state::AppState;
use crate::tools::{self, command, emit_progress, ffmpeg_bin, run_tracked};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    binary_found: bool,
    binary_path: Option<String>,
    model_found: bool,
    model_path: Option<String>,
}

fn whisper_bin(state: &AppState) -> String {
    state
        .setting("whisper_path")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| state.bundled("whisper/whisper-cli.exe"))
        .unwrap_or_else(|| if cfg!(windows) { "whisper-cli.exe".into() } else { "whisper-cli".into() })
}

/// Модель: из настроек, иначе встроенная в установщик.
fn whisper_model(state: &AppState) -> AppResult<Option<String>> {
    Ok(state
        .setting("whisper_model_path")?
        .filter(|m| !m.trim().is_empty())
        .or_else(|| state.bundled("whisper/ggml-small.bin")))
}

fn binary_works(bin: &str) -> bool {
    command(bin)
        .arg("--help")
        .output()
        .map(|o| {
            let t = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            t.contains("--model") || t.contains("usage")
        })
        .unwrap_or(false)
}

#[tauri::command]
pub async fn whisper_status(state: State<'_, AppState>) -> AppResult<WhisperStatus> {
    let bin = whisper_bin(&state);
    let model = whisper_model(&state)?;
    let found = binary_works(&bin);
    Ok(WhisperStatus {
        binary_found: found,
        binary_path: found.then_some(bin),
        model_found: model.as_ref().map(|m| Path::new(m).is_file()).unwrap_or(false),
        model_path: model,
    })
}

#[derive(Serialize)]
pub struct Cue {
    start: f64,
    end: f64,
    text: String,
}

fn parse_whisper_json(path: &Path, offset: f64) -> AppResult<Vec<Cue>> {
    let text = std::fs::read_to_string(path)?;
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let items = v["transcription"].as_array().cloned().unwrap_or_default();
    let mut cues = Vec::new();
    for it in items {
        let from = it["offsets"]["from"].as_f64().unwrap_or(0.0) / 1000.0;
        let to = it["offsets"]["to"].as_f64().unwrap_or(0.0) / 1000.0;
        let t = it["text"].as_str().unwrap_or("").trim().to_string();
        if t.is_empty() || to <= from || t.starts_with('[') && t.ends_with(']') {
            continue;
        }
        cues.push(Cue {
            start: from + offset,
            end: to + offset,
            text: t,
        });
    }
    Ok(cues)
}

/// Распознаёт речь в монтаже `spec` и возвращает реплики с таймингами Timeline.
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    spec: RenderSpec,
    language: String,
    translate: Option<bool>,
) -> AppResult<Vec<Cue>> {
    let bin = whisper_bin(&state);
    if !binary_works(&bin) {
        return Err(AppError::msg(
            "whisper.cpp не найден. Укажите путь к whisper-cli.exe в «Настройки → Субтитры».",
        ));
    }
    let model = whisper_model(&state)?
        .filter(|m| Path::new(m).is_file())
        .ok_or_else(|| AppError::msg("Модель Whisper не выбрана. Укажите файл ggml-*.bin в «Настройки → Субтитры»."))?;
    let lang = match language.as_str() {
        "ru" | "en" | "auto" => language,
        _ => "auto".into(),
    };
    let threads: u32 = state
        .setting("whisper_threads")?
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(4)
        .clamp(1, 32);
    let max_len: u32 = state
        .setting("whisper_max_len")?
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(42)
        .clamp(0, 200);

    let work: PathBuf = state.job_dir(&job_id)?;
    let wav = work.join("speech.wav");

    // 1. Звук монтажа → WAV 16 кГц моно.
    let built = render::build(
        &spec,
        &Mode::SpeechWav {
            output: wav.to_string_lossy().into_owned(),
        },
        true,
    )?;
    let total = built.duration.max(0.001);
    let mut cmd = command(&ffmpeg_bin(&state));
    cmd.current_dir(&work).args(&built.args);
    emit_progress(&app, &job_id, "transcribe", 0.0, "Подготовка звука…");
    let r = run_tracked(&state, &job_id, cmd, |is_err, line| {
        if !is_err {
            if let Some(v) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = v.trim().parse::<f64>() {
                    emit_progress(&app, &job_id, "transcribe", (us / 1e6 / total * 0.15).clamp(0.0, 0.15), "Подготовка звука…");
                }
            }
        }
    });
    if let Err(e) = r {
        let _ = std::fs::remove_dir_all(&work);
        tools::clear_cancel(&state, &job_id);
        return Err(e);
    }

    // 2. whisper.cpp → JSON.
    let out_base = work.join("result");
    let mut cmd = command(&bin);
    cmd.current_dir(&work)
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&wav)
        .args(["-l", &lang, "-t", &threads.to_string(), "-oj", "-pp"])
        .arg("-of")
        .arg(&out_base);
    if max_len > 0 {
        cmd.args(["-ml", &max_len.to_string(), "-sow"]);
    }
    if translate.unwrap_or(false) {
        cmd.arg("-tr");
    }
    emit_progress(&app, &job_id, "transcribe", 0.15, "Распознавание речи…");
    let r = run_tracked(&state, &job_id, cmd, |_, line| {
        if let Some(i) = line.find("progress =") {
            let pct: String = line[i + 10..].chars().filter(|c| c.is_ascii_digit()).collect();
            if let Ok(p) = pct.parse::<f64>() {
                emit_progress(&app, &job_id, "transcribe", 0.15 + (p / 100.0) * 0.85, "Распознавание речи…");
            }
        }
    });
    tools::clear_cancel(&state, &job_id);
    if let Err(e) = r {
        let _ = std::fs::remove_dir_all(&work);
        return Err(e);
    }
    let json = work.join("result.json");
    if !json.exists() {
        let _ = std::fs::remove_dir_all(&work);
        return Err(AppError::msg("Whisper не создал результат. Проверьте модель и версию whisper.cpp."));
    }
    let cues = parse_whisper_json(&json, 0.0);
    let _ = std::fs::remove_dir_all(&work);
    emit_progress(&app, &job_id, "transcribe", 1.0, "Готово");
    cues
}
