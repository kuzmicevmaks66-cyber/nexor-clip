use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::state::AppState;

/// Несекретные настройки, которые frontend может читать и менять.
pub const SETTING_KEYS: &[&str] = &[
    "projects_dir",
    "export_dir",
    "ffmpeg_path",
    "ffprobe_path",
    "whisper_path",
    "whisper_model_path",
    "whisper_threads",
    "whisper_max_len",
    "subtitle_default_language",
    "youtube_client_id",
    "youtube_redirect_port",
    "tiktok_client_key",
    "tiktok_redirect_port",
    "tiktok_publish_enabled",
    "user_name",
    "tracked_channels",
];

pub fn default_projects_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .map(|d| d.join("NEXOR CLIP").join("Projects"))
        .unwrap_or_else(|_| PathBuf::from("Projects"))
}

pub fn default_export_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .video_dir()
        .map(|d| d.join("NEXOR CLIP"))
        .unwrap_or_else(|_| PathBuf::from("Exports"))
}

pub fn projects_dir(app: &AppHandle, state: &AppState) -> PathBuf {
    state
        .setting("projects_dir")
        .ok()
        .flatten()
        .map(PathBuf::from)
        .unwrap_or_else(|| default_projects_dir(app))
}

pub fn export_dir(app: &AppHandle, state: &AppState) -> PathBuf {
    state
        .setting("export_dir")
        .ok()
        .flatten()
        .map(PathBuf::from)
        .unwrap_or_else(|| default_export_dir(app))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    values: HashMap<String, String>,
    defaults: HashMap<String, String>,
    /// Только признак наличия секрета — сами значения во frontend не отдаются.
    secrets: HashMap<String, bool>,
}

#[tauri::command]
pub fn get_settings(app: AppHandle, state: State<'_, AppState>) -> AppResult<SettingsView> {
    let conn = state.db()?;
    let mut values = HashMap::new();
    for k in SETTING_KEYS {
        if let Some(v) = db::get_setting(&conn, k)? {
            values.insert((*k).to_string(), v);
        }
    }
    let mut defaults = HashMap::new();
    defaults.insert("projects_dir".into(), default_projects_dir(&app).to_string_lossy().into_owned());
    defaults.insert("export_dir".into(), default_export_dir(&app).to_string_lossy().into_owned());
    defaults.insert("youtube_redirect_port".into(), "3456".into());
    defaults.insert("tiktok_redirect_port".into(), "3455".into());
    defaults.insert("whisper_threads".into(), "4".into());
    defaults.insert("whisper_max_len".into(), "42".into());
    defaults.insert("subtitle_default_language".into(), "ru".into());

    let secrets = secrets::ALLOWED
        .iter()
        .map(|k| ((*k).to_string(), secrets::has(k)))
        .collect();
    Ok(SettingsView { values, defaults, secrets })
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err(AppError::msg(format!("Неизвестная настройка: {key}")));
    }
    let conn = state.db()?;
    db::set_setting(&conn, &key, value.trim())
}

/// Сохраняет пользовательский секрет (API-ключ, client secret).
/// Токены авторизации задаются только самим приложением.
#[tauri::command]
pub fn set_secret(name: String, value: String) -> AppResult<()> {
    if !["youtube_api_key", "youtube_client_secret", "tiktok_client_secret"].contains(&name.as_str()) {
        return Err(AppError::msg("Этот секрет нельзя изменить вручную"));
    }
    secrets::set(&name, &value)
}

// ---------- Системные диалоги ----------

#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: Option<String>) -> AppResult<Option<String>> {
    let path = app
        .dialog()
        .file()
        .set_title(title.unwrap_or_else(|| "Выберите папку".into()))
        .blocking_pick_folder();
    Ok(path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_executable(app: AppHandle, title: Option<String>) -> AppResult<Option<String>> {
    let mut dlg = app.dialog().file().set_title(title.unwrap_or_else(|| "Выберите программу".into()));
    if cfg!(windows) {
        dlg = dlg.add_filter("Программа", &["exe"]);
    }
    Ok(dlg
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_model_file(app: AppHandle) -> AppResult<Option<String>> {
    Ok(app
        .dialog()
        .file()
        .set_title("Модель Whisper (ggml-*.bin)")
        .add_filter("Модель Whisper", &["bin"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

/// Выбор готового видеофайла (для публикации). Файл не изменяется.
#[tauri::command]
pub async fn pick_video_file(app: AppHandle) -> AppResult<Option<String>> {
    let p = app
        .dialog()
        .file()
        .set_title("Выберите видео")
        .add_filter("Видео MP4", &["mp4", "mov"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok());
    if let Some(path) = &p {
        crate::commands::system::allow_media(&app, path);
    }
    Ok(p.map(|p| p.to_string_lossy().into_owned()))
}
