//! OAuth 2.0 для desktop: локальный loopback-сервер + PKCE.
//! Браузер пользователя открывает официальную страницу входа Google / TikTok,
//! после подтверждения провайдер перенаправляет на http://127.0.0.1:<port>.

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

pub fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

/// PKCE для Google: base64url(SHA256(verifier)).
pub fn pkce_s256() -> (String, String) {
    let verifier = random_string(64);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

/// PKCE для TikTok Desktop: hex(SHA256(verifier)) — так требует документация TikTok.
pub fn pkce_hex() -> (String, String) {
    let verifier = random_string(64);
    let digest = Sha256::digest(verifier.as_bytes());
    (verifier, hex::encode(digest))
}

pub fn bind(port: u16) -> AppResult<TcpListener> {
    TcpListener::bind(("127.0.0.1", port)).map_err(|e| {
        AppError::msg(format!(
            "Не удалось открыть локальный порт {port} для авторизации: {e}. Закройте программу, занявшую порт, или смените порт в настройках."
        ))
    })
}

fn respond(stream: &mut TcpStream, status: &str, title: &str, text: &str) {
    let body = format!(
        "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>NEXOR CLIP</title></head>\
         <body style=\"background:#090909;color:#fff;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><div style=\"font-weight:700;letter-spacing:2px\">NEXOR CLIP</div>\
         <h2>{title}</h2><p style=\"color:#a0a0a0\">{text}</p></div></body></html>"
    );
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

/// Ждёт редирект с `code`. Запросы без `code`/`error` (например, favicon) игнорируются.
pub fn wait_for_code(listener: TcpListener, expected_state: &str, timeout: Duration) -> AppResult<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err(AppError::msg("Время ожидания авторизации истекло. Попробуйте ещё раз."));
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;

        let mut buf = Vec::new();
        let mut chunk = [0u8; 2048];
        while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 32 * 1024 {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }
        let req = String::from_utf8_lossy(&buf);
        let target = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("/")
            .to_string();
        let url = match url::Url::parse(&format!("http://127.0.0.1{target}")) {
            Ok(u) => u,
            Err(_) => {
                respond(&mut stream, "400 Bad Request", "Ошибка", "Некорректный запрос.");
                continue;
            }
        };
        let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());

        if let Some(err) = get("error") {
            let desc = get("error_description").unwrap_or_default();
            respond(&mut stream, "200 OK", "Авторизация отклонена", "Можно закрыть это окно.");
            return Err(AppError::msg(format!("Авторизация отклонена: {err} {desc}")));
        }
        let Some(code) = get("code") else {
            respond(&mut stream, "404 Not Found", "", "");
            continue;
        };
        if get("state").as_deref() != Some(expected_state) {
            respond(&mut stream, "400 Bad Request", "Ошибка безопасности", "Параметр state не совпал.");
            return Err(AppError::msg("Ошибка безопасности OAuth: параметр state не совпал."));
        }
        respond(
            &mut stream,
            "200 OK",
            "Аккаунт подключён",
            "Вернитесь в NEXOR CLIP. Это окно можно закрыть.",
        );
        return Ok(code);
    }
}
