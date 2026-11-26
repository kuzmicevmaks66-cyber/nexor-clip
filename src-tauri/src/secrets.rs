//! Секреты (API-ключи, client secrets, refresh-токены) хранятся в
//! Windows Credential Manager через `keyring`. Во frontend они никогда
//! не возвращаются — только признак «сохранено / не сохранено».

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.nexor.clip";

pub const ALLOWED: &[&str] = &[
    "youtube_api_key",
    "youtube_client_secret",
    "youtube_refresh_token",
    "tiktok_client_secret",
    "tiktok_refresh_token",
];

fn entry(name: &str) -> AppResult<keyring::Entry> {
    if !ALLOWED.contains(&name) {
        return Err(AppError::msg(format!("Неизвестный секрет: {name}")));
    }
    Ok(keyring::Entry::new(SERVICE, name)?)
}

pub fn get(name: &str) -> AppResult<Option<String>> {
    match entry(name)?.get_password() {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn set(name: &str, value: &str) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        return delete(name);
    }
    entry(name)?.set_password(value)?;
    Ok(())
}

pub fn delete(name: &str) -> AppResult<()> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn has(name: &str) -> bool {
    matches!(get(name), Ok(Some(_)))
}

pub fn require(name: &str, human: &str) -> AppResult<String> {
    get(name)?.ok_or_else(|| AppError::msg(format!("{human} не задан. Откройте «Настройки».")))
}
