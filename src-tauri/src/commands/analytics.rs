//! Локальная история метрик: каждое обновление из официальных API
//! сохраняется снимком, из которого строятся графики трендов.

use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    at: String,
    value: f64,
}

#[tauri::command]
pub fn metric_history(
    state: State<'_, AppState>,
    platform: String,
    entity_id: String,
    metric: String,
    limit: Option<i64>,
) -> AppResult<Vec<Point>> {
    let conn = state.db()?;
    let mut st = conn.prepare(
        "SELECT captured_at, value FROM (
            SELECT captured_at, value FROM metric_snapshots
            WHERE platform = ?1 AND entity_id = ?2 AND metric = ?3
            ORDER BY captured_at DESC LIMIT ?4
         ) ORDER BY captured_at ASC",
    )?;
    let rows = st
        .query_map(params![platform, entity_id, metric, limit.unwrap_or(365).clamp(1, 5000)], |r| {
            Ok(Point { at: r.get(0)?, value: r.get(1)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn last_updated(state: State<'_, AppState>, platform: String, entity_id: String) -> AppResult<Option<String>> {
    let conn = state.db()?;
    let v: Option<String> = conn.query_row(
        "SELECT MAX(captured_at) FROM metric_snapshots WHERE platform = ?1 AND entity_id = ?2",
        params![platform, entity_id],
        |r| r.get(0),
    )?;
    Ok(v)
}
