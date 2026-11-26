import type { AspectRatio } from "@/types";
import type { ProjectData } from "@/types/project";
import { DEFAULT_SUBTITLE_STYLE } from "@/features/subtitles/presets";

export function defaultProjectData(aspect: AspectRatio): ProjectData {
  return {
    version: 1,
    aspectRatio: aspect,
    fit: "crop",
    masterVolume: 1,
    media: [],
    clips: [],
    audio: [],
    overlays: [],
    subtitles: { enabled: true, language: "ru", cues: [], style: { ...DEFAULT_SUBTITLE_STYLE } },
    youtube: [],
    export: {
      resolution: 1080,
      fps: 30,
      crf: 20,
      preset: "medium",
      audioBitrate: "192k",
      folder: null,
      fileName: "NEXOR CLIP",
    },
    adRules: {
      assetIds: [],
      where: "both",
      minGap: 30,
      maxCount: 3,
      skipStart: 5,
      skipEnd: 5,
      overlayDuration: 5,
      noiseDb: -32,
      minPause: 0.45,
    },
  };
}

/** Дополняет старые/неполные данные значениями по умолчанию. */
export function normalizeProjectData(raw: unknown, aspect: AspectRatio): ProjectData {
  const base = defaultProjectData(aspect);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<ProjectData>;
  return {
    ...base,
    ...r,
    version: 1,
    aspectRatio: (r.aspectRatio as AspectRatio) ?? aspect,
    media: r.media ?? [],
    clips: r.clips ?? [],
    audio: r.audio ?? [],
    overlays: r.overlays ?? [],
    youtube: r.youtube ?? [],
    subtitles: {
      ...base.subtitles,
      ...(r.subtitles ?? {}),
      style: { ...base.subtitles.style, ...(r.subtitles?.style ?? {}) },
      cues: r.subtitles?.cues ?? [],
    },
    export: { ...base.export, ...(r.export ?? {}) },
    adRules: { ...base.adRules, ...(r.adRules ?? {}) },
  };
}
