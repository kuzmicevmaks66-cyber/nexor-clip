//! TikTok: официальный Login Kit (Desktop, PKCE), Display API (профиль,
//! список видео с метриками) и — только если пользователь явно включил —
//! Content Posting API (публикация собственного ролика).
//! Метрики, которых API не возвращает, frontend показывает как «Недоступно через API».

use serde::Serialize;
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::oauth;
use crate::secrets;
use crate::state::{AccessToken, AppState};
use crate::tools::{self, emit_progress};

const OPEN_API: &str = "https://open.tiktokapis.com/v2";
const BASE_SCOPES: &str = "user.info.basic,user.info.profile,user.info.stats,video.list";
const PUBLISH_SCOPE: &str = "video.publish";

const USER_FIELDS: &str = "open_id,avatar_url,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count";
const VIDEO_FIELDS: &str = "id,title,video_description,create_time,cover_image_url,share_url,duration,width,height,view_count,like_count,comment_count,share_count";

fn client_key(state: &AppState) -> AppResult<String> {
    state
        .setting("tiktok_client_key")?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::msg("Client Key TikTok не задан. Откройте «Настройки → TikTok»."))
}

fn client_secret() -> AppResult<String> {
    secrets::require("tiktok_client_secret", "Client Secret TikTok")
}

fn redirect_uri(state: &AppState) -> (u16, String) {
    let port = state
        .setting("tiktok_redirect_port")
        .ok()
        .flatten()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3455);
    (port, format!("http://127.0.0.1:{port}/callback/"))
}

fn publish_enabled(state: &AppState) -> bool {
    state.setting("tiktok_publish_enabled").ok().flatten().as_deref() == Some("1")
}

fn tt_error(v: &Value, status: u16) -> Option<AppError> {
    // Ответы Open API: {"data":{...},"error":{"code":"ok","message":""}}
    // Ответы OAuth: {"error":"invalid_grant","error_description":"..."}
    if let Some(code) = v["error"]["code"].as_str() {
        if code == "ok" {
            return None;
        }
        let msg = v["error"]["message"].as_str().unwrap_or("");
        let hint = match code {
            "scope_not_authorized" => " Разрешение не выдано — подключите TikTok заново.",
            "access_token_invalid" => " Токен недействителен — подключите TikTok заново.",
            "rate_limit_exceeded" => " Превышен лимит запросов — повторите позже.",
            "spam_risk_too_many_posts" => " TikTok ограничил число публикаций за день.",
            "unaudited_client_can_only_post_to_private_accounts" => {
                " Приложение не прошло аудит TikTok: публиковать можно только с приватностью «Только я»."
            }
            _ => "",
        };
        return Some(AppError::msg(format!("TikTok API: {code}. {msg}{hint}")));
    }
    if let Some(e) = v["error"].as_str() {
        let d = v["error_description"].as_str().unwrap_or("");
        return Some(AppError::msg(format!("TikTok OAuth: {e}. {d}")));
    }
    if status >= 400 {
        return Some(AppError::msg(format!("TikTok API: HTTP {status}")));
    }
    None
}

async fn parse(resp: reqwest::Response) -> AppResult<Value> {
    let status = resp.status().as_u16();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if let Some(e) = tt_error(&v, status) {
        return Err(e);
    }
    Ok(v)
}

fn store_access(state: &AppState, token: &str, expires_in: i64) {
    state.tokens.lock().unwrap_or_else(|e| e.into_inner()).insert(
        "tiktok".into(),
        AccessToken {
            token: token.to_string(),
            expires_at: chrono::Utc::now().timestamp() + expires_in - 60,
        },
    );
}

fn cached_token(state: &AppState) -> Option<String> {
    let map = state.tokens.lock().unwrap_or_else(|e| e.into_inner());
    map.get("tiktok")
        .filter(|t| t.expires_at > chrono::Utc::now().timestamp())
        .map(|t| t.token.clone())
}

fn save_tokens(state: &AppState, v: &Value) -> AppResult<String> {
    let token = v["access_token"]
        .as_str()
        .ok_or_else(|| AppError::msg("TikTok не вернул access token"))?
        .to_string();
    store_access(state, &token, v["expires_in"].as_i64().unwrap_or(86400));
    if let Some(r) = v["refresh_token"].as_str() {
        secrets::set("tiktok_refresh_token", r)?;
    }
    if let Some(scope) = v["scope"].as_str() {
        let conn = state.db()?;
        db::set_setting(&conn, "tiktok_granted_scopes", scope)?;
    }
    Ok(token)
}

async fn access_token(state: &AppState) -> AppResult<String> {
    if let Some(t) = cached_token(state) {
        return Ok(t);
    }
    let refresh = secrets::get("tiktok_refresh_token")?
        .ok_or_else(|| AppError::msg("TikTok не подключён. Подключите аккаунт в разделе TikTok или в «Настройках»."))?;
    let resp = state
        .http
        .post(format!("{OPEN_API}/oauth/token/"))
        .form(&[
            ("client_key", client_key(state)?),
            ("client_secret", client_secret()?),
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh),
        ])
        .send()
        .await?;
    match parse(resp).await {
        Ok(v) => save_tokens(state, &v),
        Err(e) => {
            if e.0.contains("invalid_grant") {
                let _ = secrets::delete("tiktok_refresh_token");
                return Err(AppError::msg("Доступ к TikTok истёк или отозван. Подключите аккаунт заново."));
            }
            Err(e)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtUser {
    open_id: String,
    display_name: Option<String>,
    username: Option<String>,
    avatar_url: Option<String>,
    bio: Option<String>,
    profile_link: Option<String>,
    is_verified: Option<bool>,
    /// None = API не вернул поле (нет разрешения / недоступно).
    followers: Option<f64>,
    following: Option<f64>,
    likes: Option<f64>,
    videos: Option<f64>,
    granted_scopes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtVideo {
    id: String,
    title: Option<String>,
    description: Option<String>,
    create_time: Option<i64>,
    cover: Option<String>,
    share_url: Option<String>,
    duration: Option<f64>,
    views: Option<f64>,
    likes: Option<f64>,
    comments: Option<f64>,
    shares: Option<f64>,
}

fn granted_scopes(state: &AppState) -> Vec<String> {
    state
        .setting("tiktok_granted_scopes")
        .ok()
        .flatten()
        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn tt_is_connected() -> bool {
    secrets::has("tiktok_refresh_token")
}

#[tauri::command]
pub async fn tt_connect(app: AppHandle, state: State<'_, AppState>) -> AppResult<TtUser> {
    let key = client_key(&state)?;
    let secret = client_secret()?;
    let (port, redirect) = redirect_uri(&state);
    let listener = oauth::bind(port)?;
    // TikTok Desktop: code_challenge = hex(SHA256(verifier)).
    let (verifier, challenge) = oauth::pkce_hex();
    let st = oauth::random_string(32);
    let scopes = if publish_enabled(&state) {
        format!("{BASE_SCOPES},{PUBLISH_SCOPE}")
    } else {
        BASE_SCOPES.to_string()
    };
    let mut url = url::Url::parse("https://www.tiktok.com/v2/auth/authorize/")?;
    url.query_pairs_mut()
        .append_pair("client_key", &key)
        .append_pair("scope", &scopes)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect)
        .append_pair("state", &st)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Не удалось открыть браузер: {e}")))?;
    let code = tauri::async_runtime::spawn_blocking(move || {
        oauth::wait_for_code(listener, &st, Duration::from_secs(300))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;

    let resp = state
        .http
        .post(format!("{OPEN_API}/oauth/token/"))
        .form(&[
            ("client_key", key),
            ("client_secret", secret),
            ("code", code),
            ("grant_type", "authorization_code".to_string()),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
        ])
        .send()
        .await?;
    let v = parse(resp).await?;
    save_tokens(&state, &v)?;
    tt_user(state).await
}

#[tauri::command]
pub async fn tt_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    let token = cached_token(&state);
    if let (Some(t), Ok(k), Ok(s)) = (token, client_key(&state), client_secret()) {
        let _ = state
            .http
            .post(format!("{OPEN_API}/oauth/revoke/"))
            .form(&[("client_key", k), ("client_secret", s), ("token", t)])
            .send()
            .await;
    }
    secrets::delete("tiktok_refresh_token")?;
    state.tokens.lock().unwrap_or_else(|e| e.into_inner()).remove("tiktok");
    let conn = state.db()?;
    db::set_setting(&conn, "tiktok_granted_scopes", "")?;
    Ok(())
}

#[tauri::command]
pub async fn tt_user(state: State<'_, AppState>) -> AppResult<TtUser> {
    let token = access_token(&state).await?;
    let resp = state
        .http
        .get(format!("{OPEN_API}/user/info/"))
        .query(&[("fields", USER_FIELDS)])
        .bearer_auth(&token)
        .send()
        .await?;
    let v = parse(resp).await?;
    let u = &v["data"]["user"];
    let user = TtUser {
        open_id: u["open_id"].as_str().unwrap_or_default().to_string(),
        display_name: u["display_name"].as_str().map(String::from),
        username: u["username"].as_str().map(String::from),
        avatar_url: u["avatar_url"].as_str().map(String::from),
        bio: u["bio_description"].as_str().map(String::from),
        profile_link: u["profile_deep_link"].as_str().map(String::from),
        is_verified: u["is_verified"].as_bool(),
        followers: u["follower_count"].as_f64(),
        following: u["following_count"].as_f64(),
        likes: u["likes_count"].as_f64(),
        videos: u["video_count"].as_f64(),
        granted_scopes: granted_scopes(&state),
    };
    if !user.open_id.is_empty() {
        let conn = state.db()?;
        for (m, val) in [("followers", user.followers), ("likes", user.likes), ("videos", user.videos)] {
            if let Some(x) = val {
                db::record_snapshot(&conn, "tiktok", &user.open_id, m, x)?;
            }
        }
    }
    Ok(user)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtVideoPage {
    videos: Vec<TtVideo>,
    cursor: Option<i64>,
    has_more: bool,
}

#[tauri::command]
pub async fn tt_videos(state: State<'_, AppState>, cursor: Option<i64>) -> AppResult<TtVideoPage> {
    let token = access_token(&state).await?;
    let mut body = json!({ "max_count": 20 });
    if let Some(c) = cursor {
        body["cursor"] = json!(c);
    }
    let resp = state
        .http
        .post(format!("{OPEN_API}/video/list/"))
        .query(&[("fields", VIDEO_FIELDS)])
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await?;
    let v = parse(resp).await?;
    let videos: Vec<TtVideo> = v["data"]["videos"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|x| TtVideo {
                    id: x["id"].as_str().map(String::from).unwrap_or_else(|| x["id"].to_string()),
                    title: x["title"].as_str().map(String::from),
                    description: x["video_description"].as_str().map(String::from),
                    create_time: x["create_time"].as_i64(),
                    cover: x["cover_image_url"].as_str().map(String::from),
                    share_url: x["share_url"].as_str().map(String::from),
                    duration: x["duration"].as_f64(),
                    views: x["view_count"].as_f64(),
                    likes: x["like_count"].as_f64(),
                    comments: x["comment_count"].as_f64(),
                    shares: x["share_count"].as_f64(),
                })
                .collect()
        })
        .unwrap_or_default();
    {
        let conn = state.db()?;
        for vid in &videos {
            for (m, val) in [("views", vid.views), ("likes", vid.likes), ("comments", vid.comments), ("shares", vid.shares)] {
                if let Some(x) = val {
                    db::record_snapshot(&conn, "tiktok_video", &vid.id, m, x)?;
                }
            }
        }
    }
    Ok(TtVideoPage {
        videos,
        cursor: v["data"]["cursor"].as_i64(),
        has_more: v["data"]["has_more"].as_bool().unwrap_or(false),
    })
}

// ---------------- Публикация (только при явном включении) ----------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtCreatorInfo {
    nickname: Option<String>,
    privacy_options: Vec<String>,
    comment_disabled: bool,
    duet_disabled: bool,
    stitch_disabled: bool,
    max_duration_sec: Option<f64>,
}

fn ensure_publish(state: &AppState) -> AppResult<()> {
    if !publish_enabled(state) {
        return Err(AppError::msg("Публикация в TikTok выключена. Включите её в «Настройки → TikTok» и переподключите аккаунт."));
    }
    if !granted_scopes(state).iter().any(|s| s == PUBLISH_SCOPE) {
        return Err(AppError::msg("Разрешение video.publish не выдано. Переподключите TikTok после включения публикации."));
    }
    Ok(())
}

#[tauri::command]
pub async fn tt_creator_info(state: State<'_, AppState>) -> AppResult<TtCreatorInfo> {
    ensure_publish(&state)?;
    let token = access_token(&state).await?;
    let resp = state
        .http
        .post(format!("{OPEN_API}/post/publish/creator_info/query/"))
        .bearer_auth(&token)
        .header("Content-Type", "application/json; charset=UTF-8")
        .body("{}")
        .send()
        .await?;
    let v = parse(resp).await?;
    let d = &v["data"];
    Ok(TtCreatorInfo {
        nickname: d["creator_nickname"].as_str().map(String::from),
        privacy_options: d["privacy_level_options"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        comment_disabled: d["comment_disabled"].as_bool().unwrap_or(false),
        duet_disabled: d["duet_disabled"].as_bool().unwrap_or(false),
        stitch_disabled: d["stitch_disabled"].as_bool().unwrap_or(false),
        max_duration_sec: d["max_video_post_duration_sec"].as_f64(),
    })
}

/// Публикует готовый MP4 через Content Posting API (Direct Post, FILE_UPLOAD).
/// Вызывается только по явному действию пользователя.
#[tauri::command]
pub async fn tt_publish(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    title: String,
    privacy_level: String,
    disable_comment: bool,
    disable_duet: bool,
    disable_stitch: bool,
) -> AppResult<String> {
    ensure_publish(&state)?;
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() {
        return Err(AppError::msg("Файл для публикации не найден"));
    }
    let size = std::fs::metadata(&file)?.len();
    if size == 0 {
        return Err(AppError::msg("Файл видео пустой."));
    }
    const CHUNK: u64 = 10 * 1024 * 1024;
    let (chunk_size, chunks) = if size < CHUNK { (size, 1) } else { (CHUNK, size / CHUNK) };
    let token = access_token(&state).await?;
    emit_progress(&app, &job_id, "publish", 0.0, "Подготовка публикации в TikTok…");
    let body = json!({
        "post_info": {
            "title": title.chars().take(2200).collect::<String>(),
            "privacy_level": privacy_level,
            "disable_comment": disable_comment,
            "disable_duet": disable_duet,
            "disable_stitch": disable_stitch
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": size,
            "chunk_size": chunk_size,
            "total_chunk_count": chunks
        }
    });
    let resp = state
        .http
        .post(format!("{OPEN_API}/post/publish/video/init/"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await?;
    let v = parse(resp).await?;
    let upload_url = v["data"]["upload_url"]
        .as_str()
        .ok_or_else(|| AppError::msg("TikTok не вернул адрес загрузки"))?
        .to_string();
    let publish_id = v["data"]["publish_id"].as_str().unwrap_or_default().to_string();

    let mut f = std::fs::File::open(&file)?;
    for i in 0..chunks {
        if tools::is_cancelled(&state, &job_id) {
            tools::clear_cancel(&state, &job_id);
            return Err(AppError::msg("Публикация отменена"));
        }
        let start = i * chunk_size;
        // Последний чанк забирает остаток файла.
        let end = if i == chunks - 1 { size - 1 } else { start + chunk_size - 1 };
        let len = end - start + 1;
        let mut buf = vec![0u8; len as usize];
        f.seek(SeekFrom::Start(start))?;
        f.read_exact(&mut buf)?;
        let resp = state
            .http_upload
            .put(&upload_url)
            .header("Content-Type", "video/mp4")
            .header("Content-Length", len.to_string())
            .header("Content-Range", format!("bytes {start}-{end}/{size}"))
            .body(buf)
            .send()
            .await?;
        let st = resp.status().as_u16();
        if !(200..300).contains(&st) {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::msg(format!("TikTok: ошибка загрузки части {} ({st}). {}", i + 1, text.chars().take(300).collect::<String>())));
        }
        emit_progress(&app, &job_id, "publish", (end + 1) as f64 / size as f64 * 0.9, "Загрузка в TikTok…");
    }

    // Ожидаем обработку на стороне TikTok.
    for _ in 0..60 {
        tokio_sleep(Duration::from_secs(3)).await;
        let resp = state
            .http
            .post(format!("{OPEN_API}/post/publish/status/fetch/"))
            .bearer_auth(&token)
            .json(&json!({ "publish_id": publish_id }))
            .send()
            .await?;
        let v = parse(resp).await?;
        let status = v["data"]["status"].as_str().unwrap_or("");
        match status {
            "PUBLISH_COMPLETE" => {
                emit_progress(&app, &job_id, "publish", 1.0, "Опубликовано в TikTok");
                return Ok(publish_id);
            }
            "FAILED" => {
                let reason = v["data"]["fail_reason"].as_str().unwrap_or("неизвестная причина");
                return Err(AppError::msg(format!("TikTok отклонил публикацию: {reason}")));
            }
            _ => emit_progress(&app, &job_id, "publish", 0.95, "TikTok обрабатывает видео…"),
        }
    }
    emit_progress(&app, &job_id, "publish", 1.0, "Видео отправлено, TikTok ещё обрабатывает его");
    Ok(publish_id)
}

async fn tokio_sleep(d: Duration) {
    // Без прямой зависимости от tokio: ждём в пуле блокирующих задач.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}
