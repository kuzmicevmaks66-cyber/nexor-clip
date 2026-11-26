use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tools;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: String,
    version: String,
    os: String,
    data_dir: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        name: "NEXOR CLIP".into(),
        version: app.package_info().version.to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    projects_count: i64,
    clips_exported: i64,
    videos_processed: i64,
}

#[tauri::command]
pub fn dashboard_stats(state: State<'_, AppState>) -> AppResult<DashboardStats> {
    let conn = state.db()?;
    let projects_count: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?;
    Ok(DashboardStats {
        projects_count,
        clips_exported: db::get_counter(&conn, "clips_exported")?,
        videos_processed: db::get_counter(&conn, "videos_processed")?,
    })
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) {
    tools::cancel(&state, &job_id);
}

/// Открывает только http(s)-ссылки во внешнем браузере.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    let parsed = url::Url::parse(&url)?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(AppError::msg("Можно открывать только http(s)-ссылки"));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Не удалось открыть браузер: {e}")))
}

/// Показывает файл или папку в Проводнике.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::msg("Файл или папка не найдены"));
    }
    let res = if p.is_dir() {
        app.opener().open_path(p.to_string_lossy().into_owned(), None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&p)
    };
    res.map_err(|e| AppError::msg(format!("Не удалось открыть Проводник: {e}")))
}

/// Разрешает воспроизведение локального медиафайла через asset-протокол.
pub fn allow_media(app: &AppHandle, path: &Path) {
    let _ = app.asset_protocol_scope().allow_file(path);
}

const MEDIA_EXT: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "flac", "png", "jpg",
    "jpeg", "webp", "gif", "bmp",
];

pub fn is_media_path(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| MEDIA_EXT.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Разрешает воспроизведение уже известных проекту файлов (после открытия проекта).
/// Принимает только медиа-расширения и существующие файлы.
#[tauri::command]
pub fn allow_media_paths(app: AppHandle, paths: Vec<String>) -> Vec<String> {
    let mut missing = Vec::new();
    for p in paths {
        let pb = PathBuf::from(&p);
        if pb.is_file() && is_media_path(&pb) {
            allow_media(&app, &pb);
        } else {
            missing.push(p);
        }
    }
    missing
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| {
            let path = e.path();
            if path.is_dir() {
                dir_size(&path)
            } else {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataUsage {
    data_dir: String,
    database_bytes: u64,
    cache_bytes: u64,
    projects: i64,
    ad_assets: i64,
    snapshots: i64,
}

#[tauri::command]
pub fn data_usage(state: State<'_, AppState>) -> AppResult<DataUsage> {
    let conn = state.db()?;
    let count = |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    let db_bytes = ["nexor.db", "nexor.db-wal", "nexor.db-shm"]
        .iter()
        .map(|f| std::fs::metadata(state.data_dir.join(f)).map(|m| m.len()).unwrap_or(0))
        .sum();
    Ok(DataUsage {
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        database_bytes: db_bytes,
        cache_bytes: dir_size(&state.cache_dir()),
        projects: count("SELECT COUNT(*) FROM projects")?,
        ad_assets: count("SELECT COUNT(*) FROM ad_assets")?,
        snapshots: count("SELECT COUNT(*) FROM metric_snapshots")?,
    })
}

/// Очищает временные файлы (кэш задач, превью). Пользовательские файлы не трогаются.
#[tauri::command]
pub fn clear_cache(state: State<'_, AppState>) -> AppResult<()> {
    let dir = state.cache_dir();
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    Ok(())
}

#[tauri::command]
pub fn clear_analytics_history(state: State<'_, AppState>) -> AppResult<()> {
    state.db()?.execute("DELETE FROM metric_snapshots", [])?;
    Ok(())
}

/// Сброс статистики главной страницы.
#[tauri::command]
pub fn reset_counters(state: State<'_, AppState>) -> AppResult<()> {
    state.db()?.execute("DELETE FROM counters", [])?;
    Ok(())
}
