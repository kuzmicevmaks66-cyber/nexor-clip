// Чистые операции над данными проекта (без побочных эффектов).
import type { MediaInfo } from "@/types";
import type { AudioItem, Clip, OverlayItem, ProjectData } from "@/types/project";
import { newId } from "@/services/tauri";
import { clipDuration, clipStarts, locate, timelineDuration } from "./spec";

export const IMAGE_DEFAULT_SEC = 4;

export function addMediaToLibrary(d: ProjectData, items: MediaInfo[]): ProjectData {
  const known = new Set(d.media.map((m) => m.path));
  const add = items.filter((m) => !known.has(m.path));
  return add.length ? { ...d, media: [...d.media, ...add] } : d;
}

export function clipFromMedia(m: MediaInfo, extra: Partial<Clip> = {}): Clip {
  const isImage = m.kind === "image";
  return {
    id: newId(),
    path: m.path,
    name: m.name,
    kind: isImage ? "image" : "video",
    sourceDuration: isImage ? 0 : m.duration,
    inPoint: 0,
    outPoint: isImage ? IMAGE_DEFAULT_SEC : m.duration,
    volume: 1,
    hasAudio: !isImage && m.hasAudio,
    ...extra,
  };
}

export function audioFromMedia(m: MediaInfo, start: number): AudioItem {
  return { id: newId(), path: m.path, name: m.name, sourceDuration: m.duration, start, inPoint: 0, outPoint: m.duration, volume: 0.6 };
}

export function overlayFromPath(path: string, name: string, start: number, len: number, extra: Partial<OverlayItem> = {}): OverlayItem {
  return { id: newId(), path, name, start, end: start + len, x: 0.85, y: 0.12, width: 0.2, opacity: 1, ...extra };
}

/** Добавление медиа: видео/изображения — на видеодорожку, аудио — на аудиодорожку. */
export function appendMedia(d: ProjectData, items: MediaInfo[], at?: number): ProjectData {
  let next = addMediaToLibrary(d, items);
  const visual = items.filter((m) => m.kind !== "audio");
  const audio = items.filter((m) => m.kind === "audio");
  if (visual.length) {
    const clips = visual.map((m) => clipFromMedia(m));
    let idx = next.clips.length;
    if (at !== undefined && next.clips.length) {
      const l = locate(next.clips, at);
      if (l) idx = l.local > clipDuration(next.clips[l.index]) / 2 ? l.index + 1 : l.index;
    }
    next = { ...next, clips: [...next.clips.slice(0, idx), ...clips, ...next.clips.slice(idx)] };
  }
  if (audio.length) {
    let start = at ?? 0;
    const added = audio.map((m) => {
      const a = audioFromMedia(m, start);
      start += m.duration;
      return a;
    });
    next = { ...next, audio: [...next.audio, ...added] };
  }
  return next;
}

/** Разрезает клип под курсором. Возвращает null, если резать нельзя. */
export function splitAt(d: ProjectData, t: number): ProjectData | null {
  const l = locate(d.clips, t);
  if (!l) return null;
  const c = d.clips[l.index];
  const dur = clipDuration(c);
  if (l.local < 0.05 || dur - l.local < 0.05) return null;
  const cut = c.inPoint + l.local;
  const a: Clip = { ...c, outPoint: cut };
  const b: Clip = { ...c, id: newId(), inPoint: cut };
  const clips = [...d.clips];
  clips.splice(l.index, 1, a, b);
  return { ...d, clips };
}

/** Удаление клипа: субтитры и наложения после него сдвигаются, чтобы остаться синхронными. */
export function removeClip(d: ProjectData, id: string, ripple = true): ProjectData {
  const i = d.clips.findIndex((c) => c.id === id);
  if (i < 0) return d;
  const start = clipStarts(d.clips)[i];
  const len = clipDuration(d.clips[i]);
  const end = start + len;
  const clips = d.clips.filter((c) => c.id !== id);
  if (!ripple) return { ...d, clips };
  const shift = (s: number, e: number): [number, number] | null => {
    if (e <= start) return [s, e];
    if (s >= end) return [s - len, e - len];
    const ns = s < start ? s : start;
    const ne = e > end ? e - len : start;
    return ne - ns >= 0.1 ? [ns, ne] : null;
  };
  const cues = d.subtitles.cues.flatMap((c) => {
    const r = shift(c.start, c.end);
    return r ? [{ ...c, start: r[0], end: r[1] }] : [];
  });
  const overlays = d.overlays.flatMap((o) => {
    const r = shift(o.start, o.end);
    return r ? [{ ...o, start: r[0], end: r[1] }] : [];
  });
  const audio = d.audio.map((a) => (a.start >= end - 0.001 ? { ...a, start: a.start - len } : a));
  return { ...d, clips, overlays, audio, subtitles: { ...d.subtitles, cues } };
}

export function moveClip(d: ProjectData, id: string, dir: -1 | 1): ProjectData {
  const i = d.clips.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.clips.length) return d;
  const clips = [...d.clips];
  [clips[i], clips[j]] = [clips[j], clips[i]];
  return { ...d, clips };
}

/** Вставка клипа в точку Timeline (точка должна быть границей монтажа или паузой). */
export function insertClipAt(d: ProjectData, clip: Clip, t: number): ProjectData {
  const starts = clipStarts(d.clips);
  const total = timelineDuration(d.clips);
  const len = clipDuration(clip);
  let base = d;
  let idx = d.clips.length;
  if (t < total - 0.05) {
    const boundary = starts.findIndex((s) => Math.abs(s - t) < 0.05);
    if (boundary >= 0) {
      idx = boundary;
    } else {
      const split = splitAt(d, t);
      if (!split) return d;
      base = split;
      idx = clipStarts(split.clips).findIndex((s) => Math.abs(s - t) < 0.06);
      if (idx < 0) return d;
    }
  }
  const clips = [...base.clips.slice(0, idx), clip, ...base.clips.slice(idx)];
  const at = idx < base.clips.length ? clipStarts(base.clips)[idx] : total;
  const shift = <T extends { start: number; end: number }>(x: T): T =>
    x.start >= at - 0.001 ? { ...x, start: x.start + len, end: x.end + len } : x;
  return {
    ...base,
    clips,
    overlays: base.overlays.map(shift),
    subtitles: { ...base.subtitles, cues: base.subtitles.cues.map(shift) },
    audio: base.audio.map((a) => (a.start >= at - 0.001 ? { ...a, start: a.start + len } : a)),
  };
}

export function mediaPaths(d: ProjectData): string[] {
  return [...new Set([...d.clips.map((c) => c.path), ...d.audio.map((a) => a.path), ...d.overlays.map((o) => o.path)])];
}
