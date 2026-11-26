import type { AppInfo, DashboardStats, DataUsage, FfmpegStatus, SettingsView, WhisperStatus } from "@/types";
import { call, isDesktop } from "./tauri";

export const APP_VERSION = "1.0.0";

export async function getAppInfo(): Promise<AppInfo> {
  if (!isDesktop()) {
    return { name: "NEXOR CLIP", version: APP_VERSION, runtime: "browser", os: navigator.platform || "unknown" };
  }
  const info = await call<Omit<AppInfo, "runtime">>("app_info");
  return { ...info, runtime: "desktop" };
}

export const checkFfmpeg = (customPath?: string) =>
  call<FfmpegStatus>("check_ffmpeg", { customPath: customPath || null });
export const whisperStatus = () => call<WhisperStatus>("whisper_status");

export async function getDashboardStats(): Promise<DashboardStats> {
  if (!isDesktop()) return { projectsCount: 0, clipsExported: 0, videosProcessed: 0 };
  return call<DashboardStats>("dashboard_stats");
}

export const getSettings = () => call<SettingsView>("get_settings");
export const setSetting = (key: string, value: string) => call<void>("set_setting", { key, value });
export const setSecret = (name: string, value: string) => call<void>("set_secret", { name, value });
export const pickFolder = (title?: string) => call<string | null>("pick_folder", { title: title ?? null });
export const pickExecutable = (title?: string) => call<string | null>("pick_executable", { title: title ?? null });
export const pickModelFile = () => call<string | null>("pick_model_file");

export const cancelJob = (jobId: string) => call<void>("cancel_job", { jobId });
export const openExternal = (url: string) => call<void>("open_external", { url });
export const revealPath = (path: string) => call<void>("reveal_path", { path });
export const allowMediaPaths = (paths: string[]) => call<string[]>("allow_media_paths", { paths });
export const dataUsage = () => call<DataUsage>("data_usage");
export const clearCache = () => call<void>("clear_cache");
export const clearAnalyticsHistory = () => call<void>("clear_analytics_history");
export const resetCounters = () => call<void>("reset_counters");
export const pickVideoFile = () => call<string | null>("pick_video_file");
