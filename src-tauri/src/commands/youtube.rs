//! YouTube: поиск и метаданные (Data API v3, ключ API), подключение канала
//! (OAuth 2.0 Desktop + PKCE), аналитика (YouTube Analytics API v2) и
//! публикация (videos.insert, resumable upload). Все запросы — из Rust,
//! ключи и токены во frontend не передаются.

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

const API: &str = "https://www.googleapis.com/youtube/v3";
const ANALYTICS: &str = "https://youtubeanalytics.googleapis.com/v2/reports";
const SCOPES: &str = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload";

fn api_key() -> AppResult<String> {
    secrets::require("youtube_api_key", "Ключ YouTube Data API")
}

async fn google_error(resp: reqwest::Response) -> AppError {
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    let msg = body["error"]["message"]
        .as_str()
        .or_else(|| body["error_description"].as_str())
        .or_else(|| body["error"].as_str())
        .unwrap_or("неизвестная ошибка")
        .to_string();
    let reason = body["error"]["errors"][0]["reason"].as_str().unwrap_or("");
    let hint = match reason {
        "quotaExceeded" | "dailyLimitExceeded" => " Дневная квота YouTube API исчерпана — попробуйте завтра.",
        "keyInvalid" => " Проверьте ключ API в настройках.",
        "accessNotConfigured" => " Включите нужный API в Google Cloud Console.",
        _ => "",
    };
    AppError::msg(format!("YouTube API ({status}): {msg}.{hint}"))
}

async fn get_json(state: &AppState, url: &str, query: &[(&str, String)], bearer: Option<&str>) -> AppResult<Value> {
    let mut req = state.http.get(url).query(query);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        return Err(google_error(resp).await);
    }
    Ok(resp.json().await?)
}

fn num(v: &Value) -> Option<f64> {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_f64())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtVideo {
    id: String,
    title: String,
    channel_id: String,
    channel_title: String,
    description: String,
    published_at: Option<String>,
    thumbnail: Option<String>,
    duration: Option<String>,
    views: Option<f64>,
    likes: Option<f64>,
    comments: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtChannel {
    id: String,
    title: String,
    description: String,
    thumbnail: Option<String>,
    custom_url: Option<String>,
    published_at: Option<String>,
    subscribers: Option<f64>,
    views: Option<f64>,
    videos: Option<f64>,
    hidden_subscribers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtSearchResult {
    videos: Vec<YtVideo>,
    channels: Vec<YtChannel>,
    next_page_token: Option<String>,
}

fn thumb(sn: &Value) -> Option<String> {
    ["maxres", "high", "medium", "default"]
        .iter()
        .find_map(|k| sn["thumbnails"][k]["url"].as_str())
        .map(String::from)
}

fn to_video(it: &Value) -> YtVideo {
    let sn = &it["snippet"];
    let st = &it["statistics"];
    YtVideo {
        id: it["id"].as_str().unwrap_or("").to_string(),
        title: sn["title"].as_str().unwrap_or("").to_string(),
        channel_id: sn["channelId"].as_str().unwrap_or("").to_string(),
        channel_title: sn["channelTitle"].as_str().unwrap_or("").to_string(),
        description: sn["description"].as_str().unwrap_or("").to_string(),
        published_at: sn["publishedAt"].as_str().map(String::from),
        thumbnail: thumb(sn),
        duration: it["contentDetails"]["duration"].as_str().map(String::from),
        views: num(&st["viewCount"]),
        likes: num(&st["likeCount"]),
        comments: num(&st["commentCount"]),
    }
}

fn to_channel(it: &Value) -> YtChannel {
    let sn = &it["snippet"];
    let st = &it["statistics"];
    let hidden = st["hiddenSubscriberCount"].as_bool().unwrap_or(false);
    YtChannel {
        id: it["id"].as_str().unwrap_or("").to_string(),
        title: sn["title"].as_str().unwrap_or("").to_string(),
        description: sn["description"].as_str().unwrap_or("").to_string(),
        thumbnail: thumb(sn),
        custom_url: sn["customUrl"].as_str().map(String::from),
        published_at: sn["publishedAt"].as_str().map(String::from),
        subscribers: if hidden { None } else { num(&st["subscriberCount"]) },
        views: num(&st["viewCount"]),
        videos: num(&st["videoCount"]),
        hidden_subscribers: hidden,
    }
}

async fn videos_by_ids(state: &AppState, ids: &[String], bearer: Option<&str>) -> AppResult<Vec<YtVideo>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for chunk in ids.chunks(50) {
        let mut q = vec![
            ("part", "snippet,statistics,contentDetails".to_string()),
            ("id", chunk.join(",")),
            ("maxResults", "50".into()),
        ];
        if bearer.is_none() {
            q.push(("key", api_key()?));
        }
        let v = get_json(state, &format!("{API}/videos"), &q, bearer).await?;
        let items = v["items"].as_array().cloned().unwrap_or_default();
        // Сохраняем порядок запроса.
        for id in chunk {
            if let Some(it) = items.iter().find(|i| i["id"].as_str() == Some(id.as_str())) {
                out.push(to_video(it));
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn yt_search(
    state: State<'_, AppState>,
    query: String,
    kind: String,
    page_token: Option<String>,
    order: Option<String>,
) -> AppResult<YtSearchResult> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::msg("Введите запрос"));
    }
    let key = api_key()?;
    let kind = if kind == "channel" { "channel" } else { "video" };
    let order = order
        .filter(|o| matches!(o.as_str(), "date" | "viewCount" | "rating"))
        .unwrap_or_else(|| "relevance".to_string());
    let mut params = vec![
        ("part", "snippet".to_string()),
        ("q", q.to_string()),
        ("type", kind.to_string()),
        ("maxResults", "24".into()),
        ("order", order),
        ("key", key.clone()),
    ];
    if let Some(t) = page_token.filter(|t| !t.is_empty()) {
        params.push(("pageToken", t));
    }
    let v = get_json(&state, &format!("{API}/search"), &params, None).await?;
    let items = v["items"].as_array().cloned().unwrap_or_default();
    let next = v["nextPageToken"].as_str().map(String::from);
    if kind == "video" {
        let ids: Vec<String> = items
            .iter()
            .filter_map(|i| i["id"]["videoId"].as_str().map(String::from))
            .collect();
        Ok(YtSearchResult {
            videos: videos_by_ids(&state, &ids, None).await?,
            channels: vec![],
            next_page_token: next,
        })
    } else {
        let ids: Vec<String> = items
            .iter()
            .filter_map(|i| i["id"]["channelId"].as_str().map(String::from))
            .collect();
        let channels = if ids.is_empty() {
            vec![]
        } else {
            let v = get_json(
                &state,
                &format!("{API}/channels"),
                &[("part", "snippet,statistics".into()), ("id", ids.join(",")), ("key", key)],
                None,
            )
            .await?;
            v["items"].as_array().map(|a| a.iter().map(to_channel).collect()).unwrap_or_default()
        };
        Ok(YtSearchResult {
            videos: vec![],
            channels,
            next_page_token: next,
        })
    }
}

#[tauri::command]
pub async fn yt_video_details(state: State<'_, AppState>, id: String) -> AppResult<YtVideo> {
    videos_by_ids(&state, &[id], None)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::msg("Видео не найдено или недоступно"))
}

/// Последние видео канала (по публичному плейлисту загрузок).
#[tauri::command]
pub async fn yt_channel_videos(state: State<'_, AppState>, channel_id: String) -> AppResult<Vec<YtVideo>> {
    let key = api_key()?;
    let v = get_json(
        &state,
        &format!("{API}/channels"),
        &[("part", "contentDetails".into()), ("id", channel_id), ("key", key.clone())],
        None,
    )
    .await?;
    let Some(uploads) = v["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"].as_str() else {
        return Ok(vec![]);
    };
    let pl = get_json(
        &state,
        &format!("{API}/playlistItems"),
        &[
            ("part", "contentDetails".into()),
            ("playlistId", uploads.to_string()),
            ("maxResults", "24".into()),
            ("key", key),
        ],
        None,
    )
    .await?;
    let ids: Vec<String> = pl["items"]
        .as_array()
        .map(|a| a.iter().filter_map(|i| i["contentDetails"]["videoId"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    videos_by_ids(&state, &ids, None).await
}

/// Публичная статистика отслеживаемых каналов (по ключу API) + снимок в локальную историю.
#[tauri::command]
pub async fn yt_channels(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<Vec<YtChannel>> {
    let ids: Vec<String> = ids
        .into_iter()
        .filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .take(50)
        .collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let v = get_json(
        &state,
        &format!("{API}/channels"),
        &[("part", "snippet,statistics".into()), ("id", ids.join(",")), ("key", api_key()?)],
        None,
    )
    .await?;
    let chans: Vec<YtChannel> = v["items"].as_array().map(|a| a.iter().map(to_channel).collect()).unwrap_or_default();
    {
        let conn = state.db()?;
        for ch in &chans {
            for (m, val) in [("subscribers", ch.subscribers), ("views", ch.views), ("videos", ch.videos)] {
                if let Some(x) = val {
                    db::record_snapshot(&conn, "youtube", &ch.id, m, x)?;
                }
            }
        }
    }
    Ok(chans)
}

// ---------------- OAuth ----------------

fn client_id(state: &AppState) -> AppResult<String> {
    state
        .setting("youtube_client_id")?
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::msg("OAuth Client ID для YouTube не задан. Откройте «Настройки → YouTube»."))
}

fn redirect_port(state: &AppState) -> u16 {
    state
        .setting("youtube_redirect_port")
        .ok()
        .flatten()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3456)
}

fn store_access(state: &AppState, token: &str, expires_in: i64) {
    state.tokens.lock().unwrap_or_else(|e| e.into_inner()).insert(
        "youtube".into(),
        AccessToken {
            token: token.to_string(),
            expires_at: chrono::Utc::now().timestamp() + expires_in - 60,
        },
    );
}

fn cached_token(state: &AppState) -> Option<String> {
    let map = state.tokens.lock().unwrap_or_else(|e| e.into_inner());
    map.get("youtube")
        .filter(|t| t.expires_at > chrono::Utc::now().timestamp())
        .map(|t| t.token.clone())
}

async fn access_token(state: &AppState) -> AppResult<String> {
    if let Some(t) = cached_token(state) {
        return Ok(t);
    }
    let refresh = secrets::get("youtube_refresh_token")?
        .ok_or_else(|| AppError::msg("YouTube-канал не подключён. Подключите его в «Настройках»."))?;
    let mut form = vec![
        ("client_id", client_id(state)?),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(s) = secrets::get("youtube_client_secret")? {
        form.push(("client_secret", s));
    }
    let resp = state.http.post("https://oauth2.googleapis.com/token").form(&form).send().await?;
    if !resp.status().is_success() {
        let err = google_error(resp).await;
        if err.0.contains("invalid_grant") {
            let _ = secrets::delete("youtube_refresh_token");
            return Err(AppError::msg("Доступ к YouTube отозван или истёк. Подключите канал заново."));
        }
        return Err(err);
    }
    let v: Value = resp.json().await?;
    let token = v["access_token"].as_str().ok_or_else(|| AppError::msg("Google не вернул access token"))?;
    store_access(state, token, v["expires_in"].as_i64().unwrap_or(3600));
    Ok(token.to_string())
}

#[tauri::command]
pub async fn yt_connect(app: AppHandle, state: State<'_, AppState>) -> AppResult<YtChannel> {
    let cid = client_id(&state)?;
    let port = redirect_port(&state);
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let listener = oauth::bind(port)?;
    let (verifier, challenge) = oauth::pkce_s256();
    let st = oauth::random_string(32);
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")?;
    url.query_pairs_mut()
        .append_pair("client_id", &cid)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &st)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Не удалось открыть браузер: {e}")))?;

    let code = tauri::async_runtime::spawn_blocking(move || {
        oauth::wait_for_code(listener, &st, Duration::from_secs(300))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;

    let mut form = vec![
        ("client_id", cid),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect),
    ];
    if let Some(s) = secrets::get("youtube_client_secret")? {
        form.push(("client_secret", s));
    }
    let resp = state.http.post("https://oauth2.googleapis.com/token").form(&form).send().await?;
    if !resp.status().is_success() {
        return Err(google_error(resp).await);
    }
    let v: Value = resp.json().await?;
    let token = v["access_token"].as_str().ok_or_else(|| AppError::msg("Google не вернул access token"))?;
    store_access(&state, token, v["expires_in"].as_i64().unwrap_or(3600));
    if let Some(r) = v["refresh_token"].as_str() {
        secrets::set("youtube_refresh_token", r)?;
    }
    yt_my_channel(state).await
}

#[tauri::command]
pub async fn yt_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    if let Ok(Some(r)) = secrets::get("youtube_refresh_token") {
        let _ = state
            .http
            .post("https://oauth2.googleapis.com/revoke")
            .form(&[("token", r)])
            .send()
            .await;
    }
    secrets::delete("youtube_refresh_token")?;
    state.tokens.lock().unwrap_or_else(|e| e.into_inner()).remove("youtube");
    Ok(())
}

#[tauri::command]
pub fn yt_is_connected() -> bool {
    secrets::has("youtube_refresh_token")
}

#[tauri::command]
pub async fn yt_my_channel(state: State<'_, AppState>) -> AppResult<YtChannel> {
    let token = access_token(&state).await?;
    let v = get_json(
        &state,
        &format!("{API}/channels"),
        &[("part", "snippet,statistics,contentDetails".into()), ("mine", "true".into())],
        Some(&token),
    )
    .await?;
    let it = v["items"]
        .get(0)
        .ok_or_else(|| AppError::msg("У этого Google-аккаунта нет YouTube-канала"))?;
    let ch = to_channel(it);
    {
        let conn = state.db()?;
        for (m, val) in [("subscribers", ch.subscribers), ("views", ch.views), ("videos", ch.videos)] {
            if let Some(x) = val {
                db::record_snapshot(&conn, "youtube", &ch.id, m, x)?;
            }
        }
    }
    Ok(ch)
}

#[tauri::command]
pub async fn yt_my_videos(state: State<'_, AppState>, page_token: Option<String>) -> AppResult<(Vec<YtVideo>, Option<String>)> {
    let token = access_token(&state).await?;
    let v = get_json(
        &state,
        &format!("{API}/channels"),
        &[("part", "contentDetails".into()), ("mine", "true".into())],
        Some(&token),
    )
    .await?;
    let uploads = v["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        .as_str()
        .ok_or_else(|| AppError::msg("Плейлист загрузок не найден"))?
        .to_string();
    let mut q = vec![
        ("part", "contentDetails".to_string()),
        ("playlistId", uploads),
        ("maxResults", "50".into()),
    ];
    if let Some(t) = page_token.filter(|t| !t.is_empty()) {
        q.push(("pageToken", t));
    }
    let pl = get_json(&state, &format!("{API}/playlistItems"), &q, Some(&token)).await?;
    let ids: Vec<String> = pl["items"]
        .as_array()
        .map(|a| a.iter().filter_map(|i| i["contentDetails"]["videoId"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let next = pl["nextPageToken"].as_str().map(String::from);
    Ok((videos_by_ids(&state, &ids, Some(&token)).await?, next))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsReport {
    /// Названия колонок, например ["day","views","likes",...]
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    /// Метрики, которые API отказался вернуть для этого отчёта.
    unavailable: Vec<String>,
}

/// Отчёт YouTube Analytics по дням. Если указан video_id — по конкретному видео.
#[tauri::command]
pub async fn yt_analytics(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
    video_id: Option<String>,
) -> AppResult<AnalyticsReport> {
    let token = access_token(&state).await?;
    let full = "views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched";
    let mut q = vec![
        ("ids", "channel==MINE".to_string()),
        ("startDate", start_date.clone()),
        ("endDate", end_date.clone()),
        ("dimensions", "day".into()),
        ("sort", "day".into()),
        ("metrics", full.into()),
    ];
    if let Some(v) = &video_id {
        q.push(("filters", format!("video=={v}")));
    }
    let resp = state.http.get(ANALYTICS).query(&q).bearer_auth(&token).send().await?;
    let (v, unavailable) = if resp.status().is_success() {
        (resp.json::<Value>().await?, vec![])
    } else {
        // Некоторые комбинации метрик недоступны — повторяем с базовым набором и честно помечаем.
        let base = "views,likes,comments";
        let q2: Vec<(&str, String)> = q
            .iter()
            .map(|(k, val)| if *k == "metrics" { (*k, base.to_string()) } else { (*k, val.clone()) })
            .collect();
        let r2 = state.http.get(ANALYTICS).query(&q2).bearer_auth(&token).send().await?;
        if !r2.status().is_success() {
            return Err(google_error(r2).await);
        }
        (
            r2.json::<Value>().await?,
            vec![
                "shares".into(),
                "subscribersGained".into(),
                "subscribersLost".into(),
                "estimatedMinutesWatched".into(),
            ],
        )
    };
    let columns = v["columnHeaders"]
        .as_array()
        .map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let rows = v["rows"]
        .as_array()
        .map(|a| a.iter().map(|r| r.as_array().cloned().unwrap_or_default()).collect())
        .unwrap_or_default();
    Ok(AnalyticsReport {
        columns,
        rows,
        unavailable,
    })
}

/// Итоги по видео за весь период (для страницы видео).
#[tauri::command]
pub async fn yt_video_totals(state: State<'_, AppState>, video_id: String, published_at: String) -> AppResult<Value> {
    let token = access_token(&state).await?;
    let start = published_at.get(0..10).unwrap_or("2005-02-14").to_string();
    let end = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let q = vec![
        ("ids", "channel==MINE".to_string()),
        ("startDate", start),
        ("endDate", end),
        ("metrics", "views,likes,comments,shares,subscribersGained".into()),
        ("filters", format!("video=={video_id}")),
    ];
    let resp = state.http.get(ANALYTICS).query(&q).bearer_auth(&token).send().await?;
    if !resp.status().is_success() {
        return Err(google_error(resp).await);
    }
    let v: Value = resp.json().await?;
    let cols: Vec<String> = v["columnHeaders"]
        .as_array()
        .map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    let row = v["rows"][0].as_array().cloned().unwrap_or_default();
    let mut out = serde_json::Map::new();
    for (i, c) in cols.iter().enumerate() {
        out.insert(c.clone(), row.get(i).cloned().unwrap_or(Value::Null));
    }
    Ok(Value::Object(out))
}

// ---------------- Публикация ----------------

/// Загружает MP4 на YouTube (resumable upload). Требует подключённого канала.
#[tauri::command]
pub async fn yt_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    title: String,
    description: String,
    tags: Vec<String>,
    privacy: String,
    made_for_kids: bool,
) -> AppResult<String> {
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() {
        return Err(AppError::msg("Файл для публикации не найден"));
    }
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 100 {
        return Err(AppError::msg("Название должно содержать от 1 до 100 символов"));
    }
    let privacy = if matches!(privacy.as_str(), "public" | "unlisted" | "private") {
        privacy
    } else {
        "private".to_string()
    };
    let size = std::fs::metadata(&file)?.len();
    if size == 0 {
        return Err(AppError::msg("Файл видео пустой."));
    }
    let token = access_token(&state).await?;
    let meta = json!({
        "snippet": { "title": title, "description": description, "tags": tags, "categoryId": "22" },
        "status": { "privacyStatus": privacy, "selfDeclaredMadeForKids": made_for_kids }
    });
    emit_progress(&app, &job_id, "publish", 0.0, "Подготовка загрузки на YouTube…");
    let init = state
        .http_upload
        .post("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status")
        .bearer_auth(&token)
        .header("X-Upload-Content-Length", size.to_string())
        .header("X-Upload-Content-Type", "video/mp4")
        .json(&meta)
        .send()
        .await?;
    if !init.status().is_success() {
        return Err(google_error(init).await);
    }
    let upload_url = init
        .headers()
        .get("location")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| AppError::msg("YouTube не вернул адрес загрузки"))?
        .to_string();

    const CHUNK: u64 = 8 * 1024 * 1024;
    let mut f = std::fs::File::open(&file)?;
    let mut offset: u64 = 0;
    loop {
        if tools::is_cancelled(&state, &job_id) {
            tools::clear_cancel(&state, &job_id);
            return Err(AppError::msg("Загрузка отменена"));
        }
        let len = CHUNK.min(size - offset);
        let mut buf = vec![0u8; len as usize];
        f.seek(SeekFrom::Start(offset))?;
        f.read_exact(&mut buf)?;
        let end = offset + len - 1;
        let resp = state
            .http_upload
            .put(&upload_url)
            .bearer_auth(&token)
            .header("Content-Length", len.to_string())
            .header("Content-Range", format!("bytes {offset}-{end}/{size}"))
            .body(buf)
            .send()
            .await?;
        let status = resp.status().as_u16();
        if status == 308 {
            offset = resp
                .headers()
                .get("range")
                .and_then(|h| h.to_str().ok())
                .and_then(|r| r.rsplit('-').next())
                .and_then(|v| v.parse::<u64>().ok())
                .map(|v| v + 1)
                .unwrap_or(end + 1);
            emit_progress(&app, &job_id, "publish", offset as f64 / size as f64 * 0.99, "Загрузка на YouTube…");
            continue;
        }
        if status == 200 || status == 201 {
            let v: Value = resp.json().await?;
            let id = v["id"].as_str().unwrap_or_default().to_string();
            emit_progress(&app, &job_id, "publish", 1.0, "Видео загружено");
            return Ok(id);
        }
        return Err(google_error(resp).await);
    }
}
