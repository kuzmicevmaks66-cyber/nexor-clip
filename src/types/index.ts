// Общие типы приложения NEXOR CLIP.

export type RouteId =
  | "home"
  | "youtube"
  | "tiktok"
  | "analytics"
  | "editor"
  | "subtitles"
  | "ads"
  | "projects"
  | "settings";

export interface AppInfo {
  name: string;
  version: string;
  /** "desktop" — запущено внутри Tauri, "browser" — только UI в браузере (режим разработки). */
  runtime: "desktop" | "browser";
  os: string;
  dataDir?: string;
}

export interface FfmpegStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  ffprobeFound: boolean;
  hasLibass: boolean;
  hasLibx264: boolean;
}

export interface WhisperStatus {
  binaryFound: boolean;
  binaryPath: string | null;
  modelFound: boolean;
  modelPath: string | null;
}

export interface DashboardStats {
  projectsCount: number;
  clipsExported: number;
  videosProcessed: number;
}

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface ProjectSummary {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  createdAt: string;
  updatedAt: string;
  lastExport: string | null;
}

/** Значение метрики: число, либо явная пометка «недоступно через API». */
export type MetricValue = { kind: "value"; value: number } | { kind: "unavailable" };

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  position: "top" | "middle" | "bottom";
  animation: "none" | "fade" | "pop" | "word";
  bold: boolean;
  uppercase: boolean;
}

export interface MediaInfo {
  path: string;
  name: string;
  kind: "video" | "audio" | "image";
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  size: number;
}

export interface SettingsView {
  values: Record<string, string>;
  defaults: Record<string, string>;
  secrets: Record<string, boolean>;
}

export interface RenderResult {
  path: string;
  duration: number;
  size: number;
}

export interface JobProgress {
  jobId: string;
  stage: string;
  /** 0..1, либо отрицательное значение — неопределённый прогресс. */
  progress: number;
  message: string;
}

export interface DataUsage {
  dataDir: string;
  databaseBytes: number;
  cacheBytes: number;
  projects: number;
  adAssets: number;
  snapshots: number;
}

export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
}
