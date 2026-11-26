use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::db;
use crate::error::{AppError, AppResult};

pub struct AccessToken {
    pub token: String,
    pub expires_at: i64,
}

pub struct AppState {
    db: Mutex<Connection>,
    pub data_dir: PathBuf,
    /// Запущенные процессы FFmpeg / Whisper по идентификатору задачи (для отмены).
    pub jobs: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    /// Идентификаторы отменённых задач (для HTTP-загрузок без процесса).
    pub cancels: Mutex<HashSet<String>>,
    /// Короткоживущие access-токены держим только в памяти.
    pub tokens: Mutex<HashMap<String, AccessToken>>,
    pub http: reqwest::Client,
    pub http_upload: reqwest::Client,
    /// Встроенные в установщик инструменты (FFmpeg, whisper.cpp, модель), если есть.
    pub tools_dir: Option<PathBuf>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let conn = db::open(&data_dir.join("nexor.db"))?;
        let http = reqwest::Client::builder()
            .user_agent("NEXOR-CLIP/1.0")
            .timeout(std::time::Duration::from_secs(60))
            .build()?;
        let http_upload = reqwest::Client::builder()
            .user_agent("NEXOR-CLIP/1.0")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(600))
            .build()?;
        Ok(Self {
            db: Mutex::new(conn),
            data_dir,
            jobs: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashSet::new()),
            tokens: Mutex::new(HashMap::new()),
            http,
            http_upload,
            tools_dir: None,
        })
    }

    pub fn db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| AppError::msg("База данных недоступна"))
    }

    /// Путь к встроенному файлу из папки tools установщика, если он существует.
    pub fn bundled(&self, rel: &str) -> Option<String> {
        let p = self.tools_dir.as_ref()?.join(rel);
        p.is_file().then(|| p.to_string_lossy().into_owned())
    }

    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.db()?;
        db::get_setting(&conn, key)
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.data_dir.join("cache")
    }

    pub fn job_dir(&self, job_id: &str) -> AppResult<PathBuf> {
        let safe: String = job_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
        if safe.is_empty() {
            return Err(AppError::msg("Некорректный идентификатор задачи"));
        }
        let dir = self.cache_dir().join("jobs").join(safe);
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }
}
