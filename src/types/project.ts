// Формат данных проекта (поле data в SQLite и в файле .nexorclip).
import type { AspectRatio, Cue, MediaInfo, SubtitleStyle } from "./index";

export type Fit = "crop" | "fit" | "blur";

export interface Clip {
  id: string;
  path: string;
  name: string;
  kind: "video" | "image";
  /** Полная длительность исходника (для изображений — 0). */
  sourceDuration: number;
  inPoint: number;
  outPoint: number;
  volume: number;
  hasAudio: boolean;
  /** Рекламная вставка (добавлена из раздела «Реклама»). */
  adAssetId?: number | null;
}

export interface AudioItem {
  id: string;
  path: string;
  name: string;
  sourceDuration: number;
  /** Позиция на Timeline. */
  start: number;
  inPoint: number;
  outPoint: number;
  volume: number;
}

export interface OverlayItem {
  id: string;
  path: string;
  name: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  opacity: number;
  adAssetId?: number | null;
}

export interface YouTubeSource {
  id: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  start: number;
  end: number;
  savedAt: string;
}

export interface ExportSettings {
  resolution: number;
  fps: number;
  crf: number;
  preset: string;
  audioBitrate: string;
  folder: string | null;
  fileName: string;
}

export interface AdRules {
  assetIds: number[];
  where: "pauses" | "cuts" | "both";
  minGap: number;
  maxCount: number;
  skipStart: number;
  skipEnd: number;
  overlayDuration: number;
  noiseDb: number;
  minPause: number;
}

export interface ProjectData {
  version: 1;
  aspectRatio: AspectRatio;
  fit: Fit;
  masterVolume: number;
  media: MediaInfo[];
  clips: Clip[];
  audio: AudioItem[];
  overlays: OverlayItem[];
  subtitles: {
    enabled: boolean;
    language: "ru" | "en" | "auto";
    cues: Cue[];
    style: SubtitleStyle;
  };
  youtube: YouTubeSource[];
  export: ExportSettings;
  adRules: AdRules;
}

export interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  createdAt: string;
  updatedAt: string;
  lastExport: string | null;
  data: ProjectData;
}
