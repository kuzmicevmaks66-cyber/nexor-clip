//! Рекламная библиотека: файлы пользователя (видео, изображения, логотипы)
//! с локального диска. Ничего не скачивается из интернета.
//! Удаление записи никогда не удаляет сам файл.

use rusqlite::params;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::media::probe;
use crate::commands::system::allow_media;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdCategory {
    id: i64,
    name: String,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdAsset {
    id: i64,
    name: String,
    /// "video" | "image" | "logo"
    kind: String,
    path: String,
    category_id: Option<i64>,
    duration: Option<f64>,
    width: Option<i64>,
    height: Option<i64>,
    has_audio: bool,
    size: i64,
    created_at: String,
    exists: bool,
}

#[tauri::command]
pub fn ad_list_categories(state: State<'_, AppState>) -> AppResult<Vec<AdCategory>> {
    let conn = state.db()?;
    let mut st = conn.prepare(
        "SELECT c.id, c.name, (SELECT COUNT(*) FROM ad_assets a WHERE a.category_id = c.id)
         FROM ad_categories c ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = st
        .query_map([], |r| Ok(AdCategory { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn clean(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::msg("Название не может быть пустым"));
    }
    Ok(n.chars().take(80).collect())
}

#[tauri::command]
pub fn ad_create_category(state: State<'_, AppState>, name: String) -> AppResult<i64> {
    let conn = state.db()?;
    conn.execute("INSERT INTO ad_categories (name) VALUES (?1)", params![clean(&name)?])
        .map_err(|_| AppError::msg("Категория с таким названием уже существует"))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn ad_rename_category(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    state
        .db()?
        .execute("UPDATE ad_categories SET name = ?1 WHERE id = ?2", params![clean(&name)?, id])
        .map_err(|_| AppError::msg("Категория с таким названием уже существует"))?;
    Ok(())
}

#[tauri::command]
pub fn ad_delete_category(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db()?;
    conn.execute("UPDATE ad_assets SET category_id = NULL WHERE category_id = ?1", params![id])?;
    conn.execute("DELETE FROM ad_categories WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn ad_list_assets(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<AdAsset>> {
    let conn = state.db()?;
    let mut st = conn.prepare(
        "SELECT id, name, kind, path, category_id, duration, width, height, has_audio, size, created_at
         FROM ad_assets ORDER BY created_at DESC",
    )?;
    let rows = st
        .query_map([], |r| {
            let path: String = r.get(3)?;
            Ok(AdAsset {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                exists: PathBuf::from(&path).is_file(),
                path,
                category_id: r.get(4)?,
                duration: r.get(5)?,
                width: r.get(6)?,
                height: r.get(7)?,
                has_audio: r.get::<_, i64>(8)? != 0,
                size: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for a in &rows {
        if a.exists {
            allow_media(&app, &PathBuf::from(&a.path));
        }
    }
    Ok(rows)
}

/// Импорт рекламных материалов с диска (диалог выбора файлов).
/// kind: "video" | "image" | "logo".
#[tauri::command]
pub async fn ad_import(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    category_id: Option<i64>,
) -> AppResult<usize> {
    let kind = match kind.as_str() {
        "video" | "image" | "logo" => kind,
        _ => return Err(AppError::msg("Неизвестный тип материала")),
    };
    let dlg = app.dialog().file().set_title("Добавить рекламные материалы");
    let dlg = if kind == "video" {
        dlg.add_filter("Видео", &["mp4", "mov", "mkv", "webm", "avi", "m4v"])
    } else {
        dlg.add_filter("Изображения", &["png", "jpg", "jpeg", "webp"])
    };
    let paths: Vec<PathBuf> = dlg
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    let mut added = 0;
    let mut errors = Vec::new();
    for p in paths {
        match probe(&state, &p) {
            Ok(info) => {
                if kind == "video" && !info.has_video {
                    errors.push(format!("{}: в файле нет видеодорожки", info.name));
                    continue;
                }
                let stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| info.name.clone());
                let duration = if kind == "video" { Some(info.duration) } else { None };
                state.db()?.execute(
                    "INSERT INTO ad_assets (name, kind, path, category_id, duration, width, height, has_audio, size, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        stem,
                        kind,
                        info.path,
                        category_id,
                        duration,
                        info.width as i64,
                        info.height as i64,
                        info.has_audio as i64,
                        info.size as i64,
                        db::now()
                    ],
                )?;
                allow_media(&app, &p);
                added += 1;
            }
            Err(e) => errors.push(e.0),
        }
    }
    if added == 0 && !errors.is_empty() {
        return Err(AppError::msg(errors.join("\n")));
    }
    Ok(added)
}

#[tauri::command]
pub fn ad_update_asset(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    category_id: Option<i64>,
    kind: String,
) -> AppResult<()> {
    let kind = if matches!(kind.as_str(), "video" | "image" | "logo") { kind } else { "image".into() };
    state.db()?.execute(
        "UPDATE ad_assets SET name = ?1, category_id = ?2, kind = CASE WHEN kind = 'video' THEN 'video' ELSE ?3 END WHERE id = ?4",
        params![clean(&name)?, category_id, kind, id],
    )?;
    Ok(())
}

/// Удаляет материал только из библиотеки. Файл на диске остаётся.
#[tauri::command]
pub fn ad_delete_asset(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db()?.execute("DELETE FROM ad_assets WHERE id = ?1", params![id])?;
    Ok(())
}
