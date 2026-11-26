import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectData } from "@/types/project";
import { fileUrl } from "@/services/tauri";
import { clipDuration, clipStarts, locate, timelineDuration } from "./spec";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Воспроизведение Timeline в реальном времени: один <video> переключается
 * между фрагментами, изображения идут по таймеру, дополнительные аудио
 * синхронизируются отдельными <audio>. Точный результат — через FFmpeg-превью.
 */
export function usePlayback(data: ProjectData | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const audios = useRef(new Map<string, HTMLAudioElement>());

  const total = data ? timelineDuration(data.clips) : 0;

  const setTime = (t: number) => {
    timeRef.current = t;
    setTimeState(t);
  };

  const syncAudio = useCallback((t: number) => {
    const d = dataRef.current;
    const map = audios.current;
    const ids = new Set(d?.audio.map((a) => a.id) ?? []);
    for (const [id, el] of map) {
      if (!ids.has(id)) {
        el.pause();
        map.delete(id);
      }
    }
    if (!d) return;
    for (const a of d.audio) {
      let el = map.get(a.id);
      const url = fileUrl(a.path);
      if (!url) continue;
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        map.set(a.id, el);
      }
      if (el.dataset.src !== url) {
        el.dataset.src = url;
        el.src = url;
      }
      const len = a.outPoint - a.inPoint;
      const active = t >= a.start && t < a.start + len;
      el.volume = clamp01(a.volume * d.masterVolume);
      if (active && playingRef.current) {
        const target = a.inPoint + (t - a.start);
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, []);

  const syncVideo = useCallback((t: number, force: boolean) => {
    const d = dataRef.current;
    const v = videoRef.current;
    if (!d || !v) return;
    const l = locate(d.clips, t);
    if (!l) {
      if (!v.paused) v.pause();
      return;
    }
    const c = d.clips[l.index];
    if (c.kind !== "video") {
      if (!v.paused) v.pause();
      return;
    }
    const url = fileUrl(c.path);
    const target = c.inPoint + l.local;
    if (v.dataset.src !== url) {
      v.dataset.src = url;
      v.src = url;
      v.currentTime = target;
    } else if (force || Math.abs(v.currentTime - target) > 0.3) {
      v.currentTime = target;
    }
    v.muted = !c.hasAudio;
    v.volume = clamp01(c.volume * d.masterVolume);
    if (playingRef.current) {
      if (v.paused) v.play().catch(() => {});
    } else if (!v.paused) {
      v.pause();
    }
  }, []);

  const seek = useCallback(
    (t: number) => {
      const d = dataRef.current;
      const tot = d ? timelineDuration(d.clips) : 0;
      const x = Math.min(Math.max(0, t), tot);
      setTime(x);
      syncVideo(x, true);
      syncAudio(x);
    },
    [syncAudio, syncVideo],
  );

  const setPlay = useCallback(
    (p: boolean) => {
      const d = dataRef.current;
      if (p && (!d || d.clips.length === 0)) return;
      if (p && d && timeRef.current >= timelineDuration(d.clips) - 0.05) setTime(0);
      playingRef.current = p;
      setPlaying(p);
      syncVideo(timeRef.current, p);
      syncAudio(timeRef.current);
    },
    [syncAudio, syncVideo],
  );

  const toggle = useCallback(() => setPlay(!playingRef.current), [setPlay]);

  // Главный цикл воспроизведения.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const d = dataRef.current;
      const v = videoRef.current;
      if (!d || d.clips.length === 0) {
        setPlay(false);
        return;
      }
      let t = timeRef.current;
      const l = locate(d.clips, t);
      if (!l) {
        setPlay(false);
        return;
      }
      const c = d.clips[l.index];
      const start = clipStarts(d.clips)[l.index];
      const dur = clipDuration(c);
      let ended = false;
      if (c.kind === "video") {
        if (v && v.dataset.src === fileUrl(c.path) && v.readyState >= 2) {
          t = Math.max(start, start + (v.currentTime - c.inPoint));
          ended = v.ended;
        }
      } else {
        t += dt;
      }
      if (ended || t >= start + dur - 0.02) {
        if (l.index >= d.clips.length - 1) {
          setTime(start + dur);
          setPlay(false);
          return;
        }
        t = start + dur + 0.001;
        setTime(t);
        syncVideo(t, true);
      } else {
        setTime(t);
      }
      syncAudio(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlay, syncAudio, syncVideo]);

  // После правок Timeline (в паузе) — пересинхронизировать кадр.
  useEffect(() => {
    if (playingRef.current) return;
    const tot = data ? timelineDuration(data.clips) : 0;
    const t = Math.min(timeRef.current, tot);
    if (t !== timeRef.current) setTime(t);
    syncVideo(t, true);
  }, [data, syncVideo]);

  useEffect(() => {
    const map = audios.current;
    return () => {
      for (const el of map.values()) el.pause();
      map.clear();
    };
  }, []);

  const loc = data ? locate(data.clips, time) : null;
  const currentClip = loc && data ? data.clips[loc.index] : null;

  return {
    videoRef,
    time,
    playing,
    total,
    seek,
    toggle,
    pause: () => setPlay(false),
    step: (dt: number) => seek(timeRef.current + dt),
    currentIndex: loc?.index ?? -1,
    currentClip,
  };
}

export type Playback = ReturnType<typeof usePlayback>;
