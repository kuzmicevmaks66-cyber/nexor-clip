// Автоматическая расстановка рекламы по правилам.
// Точки вставки — только склейки (границы фрагментов) и паузы в речи.
// Точка никогда не попадает внутрь реплики субтитров (т.е. не посреди фразы).
import type { AdRules, Clip, ProjectData } from "@/types/project";
import type { AdAsset } from "@/services/ads";
import { newId } from "@/services/tauri";
import { clipStarts, timelineDuration } from "@/features/editor/spec";
import { insertClipAt, overlayFromPath } from "@/features/editor/ops";

export interface Candidate {
  at: number;
  source: "cut" | "pause";
  /** Длина паузы (для пауз) — чем длиннее, тем лучше. */
  weight: number;
}

const SPEECH_GUARD = 0.12;

export function insideSpeech(d: ProjectData, t: number): boolean {
  return d.subtitles.cues.some((c) => t > c.start - SPEECH_GUARD && t < c.end + SPEECH_GUARD);
}

export function cutPoints(d: ProjectData): number[] {
  return clipStarts(d.clips).slice(1);
}

/** Ближайшая безопасная точка к t: склейка или промежуток между репликами. */
export function nearestSafePoint(d: ProjectData, t: number, silences: [number, number][] = []): number {
  const total = timelineDuration(d.clips);
  const options: number[] = [0, total, ...cutPoints(d), ...silences.map(([s, e]) => (s + e) / 2)];
  const cues = [...d.subtitles.cues].sort((a, b) => a.start - b.start);
  // Края реплик: сразу после окончания фразы и прямо перед началом следующей.
  const edge = SPEECH_GUARD + 0.02;
  cues.forEach((c) => {
    options.push(c.end + edge);
    options.push(c.start - edge);
  });
  const safe = options.filter((x) => x >= 0 && x <= total && !insideSpeech(d, x));
  if (!safe.length) return total;
  return safe.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), safe[0]);
}

export function collectCandidates(d: ProjectData, rules: AdRules, silences: [number, number][]): Candidate[] {
  const list: Candidate[] = [];
  if (rules.where !== "pauses") cutPoints(d).forEach((at) => list.push({ at, source: "cut", weight: 10 }));
  if (rules.where !== "cuts")
    silences.forEach(([s, e]) => {
      if (e - s >= rules.minPause) list.push({ at: (s + e) / 2, source: "pause", weight: e - s });
    });
  return list;
}

/** Выбирает точки по правилам: отступы от начала/конца, минимальный интервал, лимит. */
export function choosePoints(d: ProjectData, rules: AdRules, candidates: Candidate[]): Candidate[] {
  const total = timelineDuration(d.clips);
  const existingAds = [
    ...clipStarts(d.clips).filter((_, i) => d.clips[i].adAssetId != null),
    ...d.overlays.filter((o) => o.adAssetId != null).map((o) => o.start),
  ];
  const ok = candidates
    .filter((c) => c.at >= rules.skipStart && c.at <= total - rules.skipEnd)
    .filter((c) => !insideSpeech(d, c.at))
    .filter((c) => existingAds.every((x) => Math.abs(x - c.at) >= rules.minGap))
    .sort((a, b) => b.weight - a.weight);
  const chosen: Candidate[] = [];
  for (const c of ok) {
    if (chosen.length >= rules.maxCount) break;
    if (chosen.every((x) => Math.abs(x.at - c.at) >= rules.minGap)) chosen.push(c);
  }
  return chosen.sort((a, b) => a.at - b.at);
}

export function adClip(a: AdAsset): Clip {
  const dur = a.duration ?? 5;
  return {
    id: newId(),
    path: a.path,
    name: a.name,
    kind: "video",
    sourceDuration: dur,
    inPoint: 0,
    outPoint: dur,
    volume: 1,
    hasAudio: a.hasAudio,
    adAssetId: a.id,
  };
}

/** Вставка одного рекламного материала в точку t. */
export function placeAsset(d: ProjectData, a: AdAsset, t: number, overlaySec: number): ProjectData {
  if (a.kind === "video") return insertClipAt(d, adClip(a), t);
  const total = timelineDuration(d.clips);
  const end = Math.min(total, t + overlaySec);
  const o = overlayFromPath(a.path, a.name, Math.max(0, Math.min(t, total - 0.5)), Math.max(0.5, end - t), {
    adAssetId: a.id,
    ...(a.kind === "logo" ? { x: 0.86, y: 0.1, width: 0.18 } : { x: 0.5, y: 0.5, width: 0.6 }),
  });
  return { ...d, overlays: [...d.overlays, o] };
}

/** Применяет набор точек. Видео вставляются с конца, чтобы сдвиги не меняли ранние точки. */
export function applyPlan(d: ProjectData, plan: { at: number; asset: AdAsset }[], overlaySec: number): ProjectData {
  return [...plan].sort((a, b) => b.at - a.at).reduce((acc, p) => placeAsset(acc, p.asset, p.at, overlaySec), d);
}
