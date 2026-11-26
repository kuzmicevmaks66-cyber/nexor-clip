use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::settings::projects_dir;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    id: String,
    name: String,
    aspect_ratio: String,
    created_at: String,
    updated_at: String,
    last_export: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub aspect_ratio: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_export: Option<String>,
    /// Состояние монтажа (Timeline, субтитры, ссылки) — JSON, формат описан во frontend (types/project.ts).
    pub data: serde_json::Value,
}

fn clean_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::msg("Название проекта не может быть пустым"));
    }
    Ok(n.chars().take(120).collect())
}

fn row_to_project(r: &rusqlite::Row<'_>) -> rusqlite::Result<(Project, String)> {
    let data: String = r.get(3)?;
    Ok((
        Project {
            id: r.get(0)?,
            name: r.get(1)?,
            aspect_ratio: r.get(2)?,
            data: serde_json::Value::Null,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
            last_export: r.get(6)?,
        },
        data,
    ))
}

fn load(state: &AppState, id: &str) -> AppResult<Project> {
    let conn = state.db()?;
    let row = conn
        .query_row(
            "SELECT id, name, aspect_ratio, data, created_at, updated_at, last_export FROM projects WHERE id = ?1",
            params![id],
            row_to_project,
        )
        .optional()?;
    let (mut p, data) = row.ok_or_else(|| AppError::msg("Проект не найден"))?;
    p.data = serde_json::from_str(&data).unwrap_or(serde_json::Value::Null);
    Ok(p)
}

/// Копия проекта в папке проектов (файл .nexorclip). Ошибка записи не мешает работе с базой.
fn write_project_file(app: &AppHandle, state: &AppState, p: &Project) {
    let dir = projects_dir(app, state);
    if std::fs::create_dir_all(&dir).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(p) {
            let _ = std::fs::write(dir.join(format!("{}.nexorclip", p.id)), json);
        }
    }
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<ProjectSummary>> {
    let conn = state.db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, aspect_ratio, created_at, updated_at, last_export FROM projects ORDER BY updated_at DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                aspect_ratio: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                last_export: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    aspect_ratio: String,
    data: serde_json::Value,
) -> AppResult<Project> {
    let now = db::now();
    let p = Project {
        id: uuid::Uuid::new_v4().to_string(),
        name: clean_name(&name)?,
        aspect_ratio,
        created_at: now.clone(),
        updated_at: now,
        last_export: None,
        data,
    };
    state.db()?.execute(
        "INSERT INTO projects (id, name, aspect_ratio, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![p.id, p.name, p.aspect_ratio, serde_json::to_string(&p.data)?, p.created_at, p.updated_at],
    )?;
    write_project_file(&app, &state, &p);
    Ok(p)
}

#[tauri::command]
pub fn get_project(state: State<'_, AppState>, id: String) -> AppResult<Project> {
    load(&state, &id)
}

#[tauri::command]
pub fn save_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    aspect_ratio: String,
    data: serde_json::Value,
) -> AppResult<String> {
    let now = db::now();
    let n = state.db()?.execute(
        "UPDATE projects SET data = ?1, aspect_ratio = ?2, updated_at = ?3 WHERE id = ?4",
        params![serde_json::to_string(&data)?, aspect_ratio, now, id],
    )?;
    if n == 0 {
        return Err(AppError::msg("Проект не найден — возможно, он был удалён"));
    }
    if let Ok(p) = load(&state, &id) {
        write_project_file(&app, &state, &p);
    }
    Ok(now)
}

#[tauri::command]
pub fn rename_project(app: AppHandle, state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    let name = clean_name(&name)?;
    state.db()?.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, db::now(), id],
    )?;
    if let Ok(p) = load(&state, &id) {
        write_project_file(&app, &state, &p);
    }
    Ok(())
}

#[tauri::command]
pub fn duplicate_project(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<Project> {
    let src = load(&state, &id)?;
    create_project(app, state, format!("{} (копия)", src.name), src.aspect_ratio, src.data)
}

/// Удаляет проект из базы и его файл .nexorclip. Исходные видео пользователя НЕ удаляются.
#[tauri::command]
pub fn delete_project(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db()?.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    let file = projects_dir(&app, &state).join(format!("{id}.nexorclip"));
    if file.is_file() {
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

/// Открывает файл проекта .nexorclip (например, перенесённый с другого компьютера).
#[tauri::command]
pub async fn import_project_file(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<Project>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Открыть проект NEXOR CLIP")
        .add_filter("Проект NEXOR CLIP", &["nexorclip"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
    else {
        return Ok(None);
    };
    let text = std::fs::read_to_string(&path)?;
    let mut p: Project = serde_json::from_str(&text).map_err(|_| AppError::msg("Файл не является проектом NEXOR CLIP"))?;
    let exists: bool = state
        .db()?
        .query_row("SELECT 1 FROM projects WHERE id = ?1", params![p.id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if exists {
        p.id = uuid::Uuid::new_v4().to_string();
        p.name = format!("{} (импорт)", p.name);
    }
    p.updated_at = db::now();
    state.db()?.execute(
        "INSERT INTO projects (id, name, aspect_ratio, data, created_at, updated_at, last_export) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![p.id, p.name, p.aspect_ratio, serde_json::to_string(&p.data)?, p.created_at, p.updated_at, p.last_export],
    )?;
    write_project_file(&app, &state, &p);
    Ok(Some(p))
}

#[tauri::command]
pub fn project_file_path(app: AppHandle, state: State<'_, AppState>, id: String) -> String {
    let p: PathBuf = projects_dir(&app, &state).join(format!("{id}.nexorclip"));
    p.to_string_lossy().into_owned()
}
