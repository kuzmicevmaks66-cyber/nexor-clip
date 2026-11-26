use serde::{Serialize, Serializer};

/// Единый тип ошибки для всех команд. Во frontend уходит как строка
/// с понятным пользователю сообщением.
#[derive(Debug)]
pub struct AppError(pub String);

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError(s.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

macro_rules! from_err {
    ($($t:ty => $p:expr),* $(,)?) => {
        $(impl From<$t> for AppError {
            fn from(e: $t) -> Self { AppError(format!("{}: {}", $p, e)) }
        })*
    };
}

from_err!(
    std::io::Error => "Ошибка файловой системы",
    rusqlite::Error => "Ошибка базы данных",
    reqwest::Error => "Ошибка сети",
    serde_json::Error => "Ошибка данных",
    tauri::Error => "Ошибка приложения",
    keyring::Error => "Ошибка хранилища учётных данных Windows",
    url::ParseError => "Некорректный адрес",
);

pub type AppResult<T> = Result<T, AppError>;
