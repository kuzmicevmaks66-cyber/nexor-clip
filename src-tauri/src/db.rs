use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use crate::error::AppResult;

const SCHEMA_VERSION: i64 = 1;

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                aspect_ratio TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_export TEXT
             );
             CREATE TABLE IF NOT EXISTS ad_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
             );
             CREATE TABLE IF NOT EXISTS ad_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                category_id INTEGER REFERENCES ad_categories(id) ON DELETE SET NULL,
                duration REAL,
                width INTEGER,
                height INTEGER,
                has_audio INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS counters (
                key TEXT PRIMARY KEY,
                value INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS metric_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                metric TEXT NOT NULL,
                value REAL NOT NULL,
                captured_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_snapshots
                ON metric_snapshots(platform, entity_id, metric, captured_at);
             CREATE TABLE IF NOT EXISTS exports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             COMMIT;",
        )?;
    }
    conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
    Ok(())
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    if value.is_empty() {
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    } else {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }
    Ok(())
}

pub fn incr_counter(conn: &Connection, key: &str, by: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO counters (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = value + excluded.value",
        params![key, by],
    )?;
    Ok(())
}

pub fn get_counter(conn: &Connection, key: &str) -> AppResult<i64> {
    Ok(conn
        .query_row("SELECT value FROM counters WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?
        .unwrap_or(0))
}

pub fn record_snapshot(conn: &Connection, platform: &str, entity_id: &str, metric: &str, value: f64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO metric_snapshots (platform, entity_id, metric, value, captured_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![platform, entity_id, metric, value, now()],
    )?;
    Ok(())
}
