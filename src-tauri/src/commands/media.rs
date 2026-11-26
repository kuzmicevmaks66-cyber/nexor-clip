use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::settings::export_dir;
use crate::commands::system::{allow_media, is_media_path};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::render::{self, Mode, RCue, RenderSpec};
use crate::state::AppState;
use crate::tools::{self, command, emit_progress, ffmpeg_bin, ffprobe_bin, run_tracked};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    ffprobe_found: bool,
    has_libass: bool,
    has_libx264: bool,
}

/// Проверяет FFmpeg и ffprobe (по настройке или в PATH) и наличие нужных библиотек.
#[tauri::command]
pub async fn check_ffmpeg(state: State<'_, AppState>, custom_path: Option<String>) -> AppResult<FfmpegStatus> {
    let bin = custom_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| ffmpeg_bin(&state));
    let out = command(&bin).arg("-version").output();
    let Some(out) = out.ok().filter(|o| o.status.success()) else {
        return Ok(FfmpegStatus {
            found: false,
            path: None,
            version: None,
            ffprobe_found: false,
            has_libass: false,
            has_libx264: false,
        });
    };
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let first = text.lines().next().unwrap_or("").trim().to_string();
    let probe = {
        let p = Path::new(&bin);
        let name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
        let sibling = p.with_file_name(name);
        if p.parent().map(|d| !d.as_os_str().is_empty()).unwrap_or(false) && sibling.exists() {
            sibling.to_string_lossy().into_owned()
        } else {
            ffprobe_bin(&state)
        }
    };
    let ffprobe_found = command(&probe).arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
    Ok(FfmpegStatus {
        found: true,
        path: Some(bin),
        version: Some(first),
        ffprobe_found,
        has_libass: text.contains("--enable-libass"),
        has_libx264: text.contains("--enable-libx264"),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    /// "video" | "audio" | "image"
    pub kind: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub has_video: bool,
    pub size: u64,
}

fn parse_rate(s: &str) -> f64 {
    let mut it = s.split('/');
    let a: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let b: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1.0);
    if b == 0.0 {
        0.0
    } else {
        a / b
    }
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];

pub fn probe(state: &AppState, path: &Path) -> AppResult<MediaInfo> {
    if !path.is_file() {
        return Err(AppError::msg(format!("Файл не найден: {}", path.display())));
    }
    let out = command(&ffprobe_bin(state))
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .output()
        .map_err(|e| AppError::msg(format!("Не удалось запустить ffprobe: {e}. Укажите путь к FFmpeg в «Настройках».")))?;
    if !out.status.success() {
        return Err(AppError::msg(format!(
            "ffprobe не смог прочитать файл «{}»: {}",
            path.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0);
    let has_audio = streams.iter().any(|s| s["codec_type"] == "audio");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let duration = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .or_else(|| video.and_then(|s| s["duration"].as_str()).and_then(|d| d.parse().ok()))
        .unwrap_or(0.0);
    let kind = if IMAGE_EXT.contains(&ext.as_str()) {
        "image"
    } else if video.is_some() {
        "video"
    } else if has_audio {
        "audio"
    } else {
        return Err(AppError::msg("Файл не содержит видео или аудио"));
    };
    let (mut width, mut height, fps) = video
        .map(|s| {
            (
                s["width"].as_u64().unwrap_or(0) as u32,
                s["height"].as_u64().unwrap_or(0) as u32,
                parse_rate(s["avg_frame_rate"].as_str().unwrap_or("0/1")),
            )
        })
        .unwrap_or((0, 0, 0.0));
    // Учитываем поворот (видео с телефона).
    if let Some(s) = video {
        let rot = s["tags"]["rotate"]
            .as_str()
            .and_then(|r| r.parse::<i64>().ok())
            .or_else(|| {
                s["side_data_list"]
                    .as_array()
                    .and_then(|l| l.iter().find_map(|d| d["rotation"].as_i64()))
            })
            .unwrap_or(0);
        if rot.abs() % 180 == 90 {
            std::mem::swap(&mut width, &mut height);
        }
    }
    Ok(MediaInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        kind: kind.into(),
        duration: if kind == "image" { 0.0 } else { duration },
        width,
        height,
        fps,
        has_audio: kind != "image" && has_audio,
        has_video: kind != "audio",
        size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
    })
}

#[tauri::command]
pub async fn probe_media(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<MediaInfo> {
    let p = PathBuf::from(&path);
    if !is_media_path(&p) {
        return Err(AppError::msg("Неподдерживаемый тип файла"));
    }
    let info = probe(&state, &p)?;
    allow_media(&app, &p);
    Ok(info)
}

/// Диалог импорта. kind: "video" | "audio" | "image" | "any".
/// Файлы открываются только для чтения — приложение никогда их не изменяет.
#[tauri::command]
pub async fn import_media(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    multiple: bool,
) -> AppResult<Vec<MediaInfo>> {
    let mut dlg = app.dialog().file().set_title("Импорт медиафайлов");
    dlg = match kind.as_str() {
        "video" => dlg.add_filter("Видео", &["mp4", "mov", "mkv", "webm", "avi", "m4v"]),
        "audio" => dlg.add_filter("Аудио", &["mp3", "wav", "m4a", "aac", "ogg", "flac"]),
        "image" => dlg.add_filter("Изображения", IMAGE_EXT),
        _ => dlg.add_filter(
            "Медиа",
            &[
                "mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "flac", "png", "jpg",
                "jpeg", "webp",
            ],
        ),
    };
    let paths: Vec<PathBuf> = if multiple {
        dlg.blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect()
    } else {
        dlg.blocking_pick_file().and_then(|p| p.into_path().ok()).into_iter().collect()
    };
    let mut out = Vec::new();
    let mut errors = Vec::new();
    for p in paths {
        match probe(&state, &p) {
            Ok(info) => {
                allow_media(&app, &p);
                out.push(info);
            }
            Err(e) => errors.push(e.0),
        }
    }
    if out.is_empty() && !errors.is_empty() {
        return Err(AppError::msg(errors.join("\n")));
    }
    if !out.is_empty() {
        let conn = state.db()?;
        db::incr_counter(&conn, "videos_imported", out.len() as i64)?;
    }
    Ok(out)
}

/// Кадр-миниатюра в кэше (для Timeline и библиотеки).
#[tauri::command]
pub async fn media_thumbnail(app: AppHandle, state: State<'_, AppState>, path: String, at: f64) -> AppResult<String> {
    let src = PathBuf::from(&path);
    if !src.is_file() || !is_media_path(&src) {
        return Err(AppError::msg("Файл не найден"));
    }
    let dir = state.cache_dir().join("thumbs");
    std::fs::create_dir_all(&dir)?;
    let key = {
        use sha2::{Digest, Sha256};
        let mtime = std::fs::metadata(&src)
            .and_then(|m| m.modified())
            .map(|t| format!("{t:?}"))
            .unwrap_or_default();
        hex::encode(Sha256::digest(format!("{path}|{mtime}|{at:.2}").as_bytes()))[..24].to_string()
    };
    let out = dir.join(format!("{key}.jpg"));
    if !out.exists() {
        let res = command(&ffmpeg_bin(&state))
            .args(["-hide_banner", "-y", "-ss", &tools::secs(at), "-i"])
            .arg(&src)
            .args(["-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4"])
            .arg(&out)
            .output()
            .map_err(|e| AppError::msg(format!("Не удалось запустить FFmpeg: {e}")))?;
        if !res.status.success() || !out.exists() {
            return Err(AppError::msg("Не удалось получить кадр"));
        }
    }
    allow_media(&app, &out);
    Ok(out.to_string_lossy().into_owned())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    path: String,
    duration: f64,
    size: u64,
}

fn parse_progress_time(line: &str) -> Option<f64> {
    if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
        return v.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0);
    }
    None
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let t = cleaned.trim().trim_matches('.').to_string();
    if t.is_empty() {
        "NEXOR CLIP".into()
    } else {
        t.chars().take(120).collect()
    }
}

/// Выполняет рендер в рабочей папке задачи. Возвращает путь к результату.
fn run_render(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    spec: &RenderSpec,
    mode: Mode,
    stage: &str,
) -> AppResult<f64> {
    let work = state.job_dir(job_id)?;
    let major = tools::ffmpeg_major(state);
    let normalize_ok = major.map(|m| m >= 5).unwrap_or(true);
    let built = render::build(spec, &mode, normalize_ok)?;
    if let Some(ass) = &built.ass {
        std::fs::write(work.join("subs.ass"), ass)?;
    }
    let mut cmd = command(&ffmpeg_bin(state));
    cmd.current_dir(&work).args(&built.args);
    let total = built.duration.max(0.001);
    emit_progress(app, job_id, stage, 0.0, "Запуск FFmpeg…");
    let mut last = 0.0;
    let res = run_tracked(state, job_id, cmd, |is_err, line| {
        if !is_err {
            if let Some(t) = parse_progress_time(line) {
                let p = (t / total).clamp(0.0, 0.999);
                if p - last >= 0.005 {
                    last = p;
                    emit_progress(app, job_id, stage, p, "Обработка…");
                }
            }
        }
    });
    if let Err(e) = res {
        let msg = if e.0.contains("No such filter: 'subtitles'") || e.0.contains("No such filter: \"subtitles\"") {
            "Эта сборка FFmpeg не поддерживает вшивание субтитров (нет libass). Установите полную сборку FFmpeg (gyan.dev full build)."
                .to_string()
        } else if e.0.contains("Unknown encoder 'libx264'") {
            "Эта сборка FFmpeg не содержит кодек H.264 (libx264). Установите полную сборку FFmpeg.".to_string()
        } else {
            e.0
        };
        let _ = std::fs::remove_dir_all(&work);
        return Err(AppError::msg(msg));
    }
    let _ = std::fs::remove_dir_all(&work);
    Ok(built.duration)
}

#[tauri::command]
pub async fn export_video(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    spec: RenderSpec,
    output_dir: Option<String>,
    file_name: String,
    crf: u32,
    preset: String,
    audio_bitrate: String,
    project_id: Option<String>,
) -> AppResult<RenderResult> {
    let dir = output_dir
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| export_dir(&app, &state));
    std::fs::create_dir_all(&dir)?;
    let base = sanitize_file_name(&file_name);
    let mut out = dir.join(format!("{base}.mp4"));
    let mut n = 2;
    while out.exists() {
        out = dir.join(format!("{base} ({n}).mp4"));
        n += 1;
    }
    // Нельзя перезаписать исходник.
    if spec.clips.iter().any(|c| Path::new(&c.path) == out) {
        return Err(AppError::msg("Файл результата совпадает с исходным"));
    }
    let preset = match preset.as_str() {
        "ultrafast" | "veryfast" | "faster" | "fast" | "medium" | "slow" => preset,
        _ => "medium".into(),
    };
    let audio_bitrate = match audio_bitrate.as_str() {
        "128k" | "160k" | "192k" | "256k" | "320k" => audio_bitrate,
        _ => "192k".into(),
    };
    let mode = Mode::Video {
        output: out.to_string_lossy().into_owned(),
        crf: crf.clamp(14, 35),
        preset,
        audio_bitrate,
    };
    let result = run_render(&app, &state, &job_id, &spec, mode, "export");
    if let Err(e) = result {
        let _ = std::fs::remove_file(&out);
        tools::clear_cancel(&state, &job_id);
        emit_progress(&app, &job_id, "export", -1.0, &e.0);
        return Err(e);
    }
    let duration = result?;
    {
        let conn = state.db()?;
        db::incr_counter(&conn, "clips_exported", 1)?;
        db::incr_counter(&conn, "videos_processed", spec.clips.len() as i64)?;
        let now = db::now();
        conn.execute(
            "INSERT INTO exports (project_id, path, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![project_id, out.to_string_lossy(), now],
        )?;
        if let Some(pid) = &project_id {
            conn.execute(
                "UPDATE projects SET last_export = ?1 WHERE id = ?2",
                rusqlite::params![out.to_string_lossy(), pid],
            )?;
        }
    }
    allow_media(&app, &out);
    emit_progress(&app, &job_id, "export", 1.0, "Готово");
    Ok(RenderResult {
        path: out.to_string_lossy().into_owned(),
        duration,
        size: std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0),
    })
}

/// Быстрый предпросмотр результата в низком разрешении (кэш).
#[tauri::command]
pub async fn render_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    mut spec: RenderSpec,
) -> AppResult<RenderResult> {
    let dir = state.cache_dir().join("preview");
    std::fs::create_dir_all(&dir)?;
    // Удаляем старые предпросмотры.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let scale = 640.0 / (spec.width.max(spec.height) as f64);
    if scale < 1.0 {
        spec.width = ((spec.width as f64 * scale).round() as u32 / 2 * 2).max(2);
        spec.height = ((spec.height as f64 * scale).round() as u32 / 2 * 2).max(2);
    }
    spec.fps = spec.fps.min(30.0);
    let out = dir.join(format!("{job_id}.mp4"));
    let mode = Mode::Video {
        output: out.to_string_lossy().into_owned(),
        crf: 30,
        preset: "ultrafast".into(),
        audio_bitrate: "128k".into(),
    };
    let r = run_render(&app, &state, &job_id, &spec, mode, "preview");
    tools::clear_cancel(&state, &job_id);
    let duration = r?;
    allow_media(&app, &out);
    emit_progress(&app, &job_id, "preview", 1.0, "Готово");
    Ok(RenderResult {
        path: out.to_string_lossy().into_owned(),
        duration,
        size: std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0),
    })
}

/// Поиск пауз в речи на Timeline (используется для размещения рекламы).
#[tauri::command]
pub async fn detect_silences(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    spec: RenderSpec,
    noise_db: f64,
    min_duration: f64,
) -> AppResult<Vec<(f64, f64)>> {
    let work = state.job_dir(&job_id)?;
    let built = render::build(
        &spec,
        &Mode::Silence {
            noise_db,
            min_duration,
        },
        true,
    )?;
    let mut cmd = command(&ffmpeg_bin(&state));
    cmd.current_dir(&work).args(&built.args);
    let mut silences = Vec::new();
    let mut open: Option<f64> = None;
    emit_progress(&app, &job_id, "silence", -1.0, "Анализ пауз…");
    let res = run_tracked(&state, &job_id, cmd, |is_err, line| {
        if !is_err {
            return;
        }
        if let Some(i) = line.find("silence_start:") {
            open = line[i + 14..].trim().split_whitespace().next().and_then(|v| v.parse().ok());
        } else if let Some(i) = line.find("silence_end:") {
            let end: Option<f64> = line[i + 12..].trim().split_whitespace().next().and_then(|v| v.parse().ok());
            if let (Some(s), Some(e)) = (open.take(), end) {
                silences.push((s.max(0.0), e));
            }
        }
    });
    let _ = std::fs::remove_dir_all(&work);
    tools::clear_cancel(&state, &job_id);
    res?;
    if let Some(s) = open {
        silences.push((s, built.duration));
    }
    Ok(silences)
}

/// Сохраняет субтитры в .srt через диалог.
#[tauri::command]
pub async fn export_srt(app: AppHandle, cues: Vec<RCue>, default_name: String) -> AppResult<Option<String>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Сохранить субтитры")
        .set_file_name(format!("{}.srt", sanitize_file_name(&default_name)))
        .add_filter("Субтитры SRT", &["srt"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    std::fs::write(&path, render::build_srt(&cues))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Читает .srt (импорт готовых субтитров).
#[tauri::command]
pub async fn import_srt(app: AppHandle) -> AppResult<Option<Vec<RCueOut>>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Импорт субтитров")
        .add_filter("Субтитры SRT", &["srt"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    let text = std::fs::read_to_string(&path)?;
    Ok(Some(parse_srt(&text)))
}

#[derive(Serialize)]
pub struct RCueOut {
    start: f64,
    end: f64,
    text: String,
}

fn parse_srt(text: &str) -> Vec<RCueOut> {
    fn t(s: &str) -> Option<f64> {
        let s = s.trim().replace(',', ".");
        let p: Vec<&str> = s.split(':').collect();
        if p.len() != 3 {
            return None;
        }
        Some(p[0].parse::<f64>().ok()? * 3600.0 + p[1].parse::<f64>().ok()? * 60.0 + p[2].parse::<f64>().ok()?)
    }
    let norm = text.replace("\r\n", "\n").trim_start_matches('\u{feff}').to_string();
    norm.split("\n\n")
        .filter_map(|block| {
            let lines: Vec<&str> = block.lines().filter(|l| !l.trim().is_empty()).collect();
            let ti = lines.iter().position(|l| l.contains("-->"))?;
            let (a, b) = lines[ti].split_once("-->")?;
            let start = t(a)?;
            let end = t(b.split_whitespace().next()?)?;
            let text = lines[ti + 1..].join("\n");
            Some(RCueOut { start, end, text })
        })
        .collect()
}

/// Выбор папки экспорта (из окна экспорта).
#[tauri::command]
pub async fn default_export_dir_path(app: AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    Ok(export_dir(&app, &state).to_string_lossy().into_owned())
}
