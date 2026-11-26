//! NEXOR CLIP — точка входа Tauri.
//! Все данные хранятся локально (SQLite в папке данных приложения),
//! секреты — в Windows Credential Manager.

mod commands;
mod db;
mod error;
mod oauth;
mod render;
mod secrets;
mod state;
mod tools;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let mut st = state::AppState::new(dir).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            st.tools_dir = app.path().resource_dir().ok().map(|d| d.join("tools")).filter(|d| d.is_dir());
            app.manage(st);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // система
            commands::system::app_info,
            commands::system::dashboard_stats,
            commands::system::cancel_job,
            commands::system::open_external,
            commands::system::reveal_path,
            commands::system::allow_media_paths,
            commands::system::data_usage,
            commands::system::clear_cache,
            commands::system::clear_analytics_history,
            commands::system::reset_counters,
            // настройки
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::settings::set_secret,
            commands::settings::pick_folder,
            commands::settings::pick_executable,
            commands::settings::pick_model_file,
            commands::settings::pick_video_file,
            // проекты
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::get_project,
            commands::projects::save_project,
            commands::projects::rename_project,
            commands::projects::duplicate_project,
            commands::projects::delete_project,
            commands::projects::import_project_file,
            commands::projects::project_file_path,
            // медиа / FFmpeg
            commands::media::check_ffmpeg,
            commands::media::probe_media,
            commands::media::import_media,
            commands::media::media_thumbnail,
            commands::media::export_video,
            commands::media::render_preview,
            commands::media::detect_silences,
            commands::media::export_srt,
            commands::media::import_srt,
            commands::media::default_export_dir_path,
            // whisper
            commands::whisper::whisper_status,
            commands::whisper::transcribe,
            // YouTube
            commands::youtube::yt_search,
            commands::youtube::yt_video_details,
            commands::youtube::yt_channel_videos,
            commands::youtube::yt_channels,
            commands::youtube::yt_connect,
            commands::youtube::yt_disconnect,
            commands::youtube::yt_is_connected,
            commands::youtube::yt_my_channel,
            commands::youtube::yt_my_videos,
            commands::youtube::yt_analytics,
            commands::youtube::yt_video_totals,
            commands::youtube::yt_upload,
            // TikTok
            commands::tiktok::tt_is_connected,
            commands::tiktok::tt_connect,
            commands::tiktok::tt_disconnect,
            commands::tiktok::tt_user,
            commands::tiktok::tt_videos,
            commands::tiktok::tt_creator_info,
            commands::tiktok::tt_publish,
            // аналитика
            commands::analytics::metric_history,
            commands::analytics::last_updated,
            // реклама
            commands::ads::ad_list_categories,
            commands::ads::ad_create_category,
            commands::ads::ad_rename_category,
            commands::ads::ad_delete_category,
            commands::ads::ad_list_assets,
            commands::ads::ad_import,
            commands::ads::ad_update_asset,
            commands::ads::ad_delete_asset,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска NEXOR CLIP");
}
