// Преобразование проекта в RenderSpec для backend (FFmpeg).
import type { AspectRatio } from "@/types";
import type { Clip, ProjectData } from "@/types/project";

export interface RenderSpec {
  clips: { path: string; kind: "video" | "image"; inPoint: number; outPoint: number; volume: number; hasAudio: boolean }[];
  audio: { path: string; start: number; inPoint: number; outPoint: number; volume: number }[];
  overlays: { path: string; start: number; end: number; x: number; y: number; width: number; opacity: number }[];
  subtitles: {
    cues: { start: number; end: number; text: string }[];
    style: {
      fontFamily: string;
      fontSize: number;
      color: string;
      outlineColor: string;
      outlineWidth: number;
      shadow: boolean;
      position: string;
      animation: string;
      bold: boolean;
      uppercase: boolean;
    };
  } | null;
  width: number;
  height: number;
  fps: number;
  fit: string;
  masterVolume: number;
}

export const RESOLUTIONS = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p (2K)" },
  { value: 2160, label: "2160p (4K)" },
];
export const FPS_OPTIONS = [24, 25, 30, 50, 60];
export const QUALITY = [
  { crf: 16, label: "Максимальное" },
  { crf: 20, label: "Высокое" },
  { crf: 23, label: "Стандартное" },
  { crf: 28, label: "Компактное" },
];

/** Размер кадра: «resolution» — короткая сторона (720p в 9:16 = 720×1280). */
export function frameSize(aspect: AspectRatio, resolution: number): { width: number; height: number } {
  const even = (n: number) => Math.round(n / 2) * 2;
  if (aspect === "1:1") return { width: resolution, height: resolution };
  const long = even((resolution * 16) / 9);
  return aspect === "9:16" ? { width: resolution, height: long } : { width: long, height: resolution };
}

export const clipDuration = (c: Clip) => Math.max(0, c.outPoint - c.inPoint);
export const timelineDuration = (clips: Clip[]) => clips.reduce((s, c) => s + clipDuration(c), 0);

/** Позиции начала каждого клипа на Timeline. */
export function clipStarts(clips: Clip[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of clips) {
    out.push(t);
    t += clipDuration(c);
  }
  return out;
}

/** Находит клип по времени Timeline. */
export function locate(clips: Clip[], t: number): { index: number; local: number } | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = clipDuration(clips[i]);
    if (t < acc + d || i === clips.length - 1) {
      return { index: i, local: Math.min(Math.max(0, t - acc), d) };
    }
    acc += d;
  }
  return null;
}

export function buildSpec(
  data: ProjectData,
  opts: { resolution?: number; fps?: number; withSubtitles?: boolean; withAudio?: boolean } = {},
): RenderSpec {
  const { width, height } = frameSize(data.aspectRatio, opts.resolution ?? data.export.resolution);
  const total = timelineDuration(data.clips);
  const subs = data.subtitles;
  const withSubs = (opts.withSubtitles ?? subs.enabled) && subs.cues.length > 0;
  return {
    clips: data.clips.map((c) => ({
      path: c.path,
      kind: c.kind,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      volume: c.volume,
      hasAudio: c.hasAudio,
    })),
    audio:
      opts.withAudio === false
        ? []
        : data.audio
            .filter((a) => a.start < total && a.outPoint > a.inPoint)
            .map((a) => ({ path: a.path, start: a.start, inPoint: a.inPoint, outPoint: a.outPoint, volume: a.volume })),
    overlays: data.overlays
      .filter((o) => o.end > o.start && o.start < total)
      .map((o) => ({ path: o.path, start: o.start, end: Math.min(o.end, total), x: o.x, y: o.y, width: o.width, opacity: o.opacity })),
    subtitles: withSubs
      ? {
          cues: subs.cues.filter((c) => c.end > c.start && c.text.trim()).map((c) => ({ start: c.start, end: c.end, text: c.text })),
          style: { ...subs.style },
        }
      : null,
    width,
    height,
    fps: opts.fps ?? data.export.fps,
    fit: data.fit,
    masterVolume: data.masterVolume,
  };
}
