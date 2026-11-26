import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { Captions, Film, Image as ImageIcon, Music, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectData } from "@/types/project";
import { Button } from "@/components/ui";
import { formatTime } from "@/services/format";
import { useThumbnail } from "@/hooks/useThumbnail";
import { clipDuration, clipStarts, timelineDuration } from "./spec";

export type Selection = { kind: "clip" | "audio" | "overlay" | "cue"; id: string } | null;

interface Props {
  data: ProjectData;
  time: number;
  onSeek: (t: number) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Изменение проекта; coalesce — ключ для объединения шагов отмены при перетаскивании. */
  onChange: (fn: (d: ProjectData) => ProjectData, coalesce?: string) => void;
  markers?: number[];
  toolbar?: React.ReactNode;
}

const MIN_LEN = 0.1;

type Drag =
  | { type: "clip-in" | "clip-out"; id: string; x0: number; in0: number; out0: number }
  | { type: "move-audio"; id: string; x0: number; start0: number }
  | { type: "audio-in" | "audio-out"; id: string; x0: number; in0: number; out0: number; start0: number }
  | { type: "move-overlay" | "overlay-in" | "overlay-out"; id: string; x0: number; start0: number; end0: number }
  | { type: "move-cue" | "cue-in" | "cue-out"; id: string; x0: number; start0: number; end0: number }
  | { type: "scrub" };

function ClipBlock({ path, kind, label, left, width, selected, ad, onDown, onHandle }: {
  path: string;
  kind: string;
  label: string;
  left: number;
  width: number;
  selected: boolean;
  ad: boolean;
  onDown: (e: RPE) => void;
  onHandle: (side: "l" | "r", e: RPE) => void;
}) {
  const thumb = useThumbnail(path, kind, 0.5);
  return (
    <div
      className={`item ${selected ? "is-selected" : ""} ${ad ? "item--ad" : ""}`}
      style={{ left, width: Math.max(4, width - 2) }}
      onPointerDown={onDown}
      title={label}
    >
      {thumb && width > 60 && <img className="item__thumb" src={thumb} alt="" draggable={false} />}
      {width > 30 && <span className="item__label">{label}</span>}
      <div className="item__handle item__handle--l" onPointerDown={(e) => onHandle("l", e)} />
      <div className="item__handle item__handle--r" onPointerDown={(e) => onHandle("r", e)} />
    </div>
  );
}

export function Timeline({ data, time, onSeek, selection, onSelect, onChange, markers = [], toolbar }: Props) {
  const [pps, setPps] = useState(40); // пикселей на секунду
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const total = timelineDuration(data.clips);
  const starts = useMemo(() => clipStarts(data.clips), [data.clips]);
  const audioEnd = data.audio.reduce((m, a) => Math.max(m, a.start + a.outPoint - a.inPoint), 0);
  const span = Math.max(total, audioEnd, 10) + 5;
  const width = span * pps;

  // Автоподбор масштаба при первом показе.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !scrollRef.current || total <= 0) return;
    fitted.current = true;
    const w = scrollRef.current.clientWidth - 20;
    setPps(Math.min(200, Math.max(2, w / (total + 2))));
  }, [total]);

  // Автопрокрутка за курсором.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, pps]);

  const tickStep = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return steps.find((s) => s * pps >= 70) ?? 600;
  }, [pps]);

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / pps);
  };

  const begin = (d: Drag, e: RPE) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = d;
    cleanup.current?.();
    const move = (ev: PointerEvent) => onMove(ev);
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    cleanup.current = up;
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.type === "scrub") {
      onSeek(Math.min(xToTime(e.clientX), total));
      return;
    }
    const dt = (e.clientX - d.x0) / pps;
    const key = `drag-${d.type}-${d.id}`;
    onChange((p) => {
      switch (d.type) {
        case "clip-in":
        case "clip-out":
          return {
            ...p,
            clips: p.clips.map((c) => {
              if (c.id !== d.id) return c;
              const maxOut = c.kind === "image" ? 3600 : c.sourceDuration;
              if (d.type === "clip-in") return { ...c, inPoint: Math.min(Math.max(0, d.in0 + dt), d.out0 - MIN_LEN) };
              return { ...c, outPoint: Math.max(Math.min(maxOut, d.out0 + dt), d.in0 + MIN_LEN) };
            }),
          };
        case "move-audio":
          return { ...p, audio: p.audio.map((a) => (a.id === d.id ? { ...a, start: Math.max(0, d.start0 + dt) } : a)) };
        case "audio-in":
        case "audio-out":
          return {
            ...p,
            audio: p.audio.map((a) => {
              if (a.id !== d.id) return a;
              if (d.type === "audio-in") {
                const ni = Math.min(Math.max(0, d.in0 + dt), d.out0 - MIN_LEN);
                return { ...a, inPoint: ni, start: Math.max(0, d.start0 + (ni - d.in0)) };
              }
              return { ...a, outPoint: Math.max(Math.min(a.sourceDuration, d.out0 + dt), d.in0 + MIN_LEN) };
            }),
          };
        case "move-overlay":
        case "overlay-in":
        case "overlay-out":
          return {
            ...p,
            overlays: p.overlays.map((o) => {
              if (o.id !== d.id) return o;
              if (d.type === "move-overlay") {
                const len = d.end0 - d.start0;
                const s = Math.max(0, d.start0 + dt);
                return { ...o, start: s, end: s + len };
              }
              if (d.type === "overlay-in") return { ...o, start: Math.min(Math.max(0, d.start0 + dt), d.end0 - MIN_LEN) };
              return { ...o, end: Math.max(d.end0 + dt, d.start0 + MIN_LEN) };
            }),
          };
        case "move-cue":
        case "cue-in":
        case "cue-out": {
          const cues = p.subtitles.cues.map((c) => {
            if (c.id !== d.id) return c;
            if (d.type === "move-cue") {
              const len = d.end0 - d.start0;
              const s = Math.max(0, d.start0 + dt);
              return { ...c, start: s, end: s + len };
            }
            if (d.type === "cue-in") return { ...c, start: Math.min(Math.max(0, d.start0 + dt), d.end0 - MIN_LEN) };
            return { ...c, end: Math.max(d.end0 + dt, d.start0 + MIN_LEN) };
          });
          return { ...p, subtitles: { ...p.subtitles, cues } };
        }
      }
      return p;
    }, key);
  };

  useEffect(() => () => cleanup.current?.(), []);

  const ticks: number[] = [];
  for (let t = 0; t <= span; t += tickStep) ticks.push(t);

  const scrubStart = (e: RPE) => {
    onSeek(Math.min(xToTime(e.clientX), total));
    begin({ type: "scrub" }, e);
  };

  const laneClick = (e: RPE) => {
    if (e.target === e.currentTarget) {
      onSelect(null);
      onSeek(Math.min(xToTime(e.clientX), total));
    }
  };

  const isSel = (kind: NonNullable<Selection>["kind"], id: string) => selection?.kind === kind && selection.id === id;

  return (
    <div className="timeline">
      <div className="timeline__toolbar">
        {toolbar}
        <span className="spacer" />
        <Button size="sm" iconOnly icon={ZoomOut} title="Уменьшить масштаб" onClick={() => setPps((p) => Math.max(1, p / 1.5))} />
        <Button size="sm" iconOnly icon={ZoomIn} title="Увеличить масштаб" onClick={() => setPps((p) => Math.min(400, p * 1.5))} />
      </div>
      <div className="timeline__body">
        <div className="timeline__labels">
          <div />
          <div><Film size={14} /> Видео</div>
          <div><ImageIcon size={14} /> Наложения</div>
          <div><Music size={14} /> Аудио</div>
          <div><Captions size={14} /> Субтитры</div>
        </div>
        <div className="timeline__scroll" ref={scrollRef}>
          <div className="timeline__inner" style={{ width }}>
            <div className="ruler" onPointerDown={scrubStart}>
              {ticks.map((t) => (
                <div key={t} className="ruler__tick" style={{ left: t * pps }}>
                  <span>{formatTime(t, false)}</span>
                </div>
              ))}
            </div>

            <div className="lane" onPointerDown={laneClick}>
              {data.clips.map((c, i) => (
                <ClipBlock
                  key={c.id}
                  path={c.path}
                  kind={c.kind}
                  label={c.name}
                  ad={!!c.adAssetId}
                  left={starts[i] * pps}
                  width={clipDuration(c) * pps}
                  selected={isSel("clip", c.id)}
                  onDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: "clip", id: c.id });
                    onSeek(Math.min(xToTime(e.clientX), total));
                  }}
                  onHandle={(side, e) => {
                    onSelect({ kind: "clip", id: c.id });
                    begin({ type: side === "l" ? "clip-in" : "clip-out", id: c.id, x0: e.clientX, in0: c.inPoint, out0: c.outPoint }, e);
                  }}
                />
              ))}
            </div>

            <div className="lane" onPointerDown={laneClick}>
              {data.overlays.map((o) => (
                <div
                  key={o.id}
                  className={`item ${o.adAssetId ? "item--ad" : ""} ${isSel("overlay", o.id) ? "is-selected" : ""}`}
                  style={{ left: o.start * pps, width: Math.max(4, (o.end - o.start) * pps) }}
                  title={o.name}
                  onPointerDown={(e) => {
                    onSelect({ kind: "overlay", id: o.id });
                    begin({ type: "move-overlay", id: o.id, x0: e.clientX, start0: o.start, end0: o.end }, e);
                  }}
                >
                  <span className="item__label">{o.name}</span>
                  <div className="item__handle item__handle--l" onPointerDown={(e) => begin({ type: "overlay-in", id: o.id, x0: e.clientX, start0: o.start, end0: o.end }, e)} />
                  <div className="item__handle item__handle--r" onPointerDown={(e) => begin({ type: "overlay-out", id: o.id, x0: e.clientX, start0: o.start, end0: o.end }, e)} />
                </div>
              ))}
            </div>

            <div className="lane" onPointerDown={laneClick}>
              {data.audio.map((a) => (
                <div
                  key={a.id}
                  className={`item item--audio ${isSel("audio", a.id) ? "is-selected" : ""}`}
                  style={{ left: a.start * pps, width: Math.max(4, (a.outPoint - a.inPoint) * pps) }}
                  title={a.name}
                  onPointerDown={(e) => {
                    onSelect({ kind: "audio", id: a.id });
                    begin({ type: "move-audio", id: a.id, x0: e.clientX, start0: a.start }, e);
                  }}
                >
                  <span className="item__label">{a.name}</span>
                  <div className="item__handle item__handle--l" onPointerDown={(e) => begin({ type: "audio-in", id: a.id, x0: e.clientX, in0: a.inPoint, out0: a.outPoint, start0: a.start }, e)} />
                  <div className="item__handle item__handle--r" onPointerDown={(e) => begin({ type: "audio-out", id: a.id, x0: e.clientX, in0: a.inPoint, out0: a.outPoint, start0: a.start }, e)} />
                </div>
              ))}
            </div>

            <div className="lane" onPointerDown={laneClick}>
              {data.subtitles.cues.map((c) => (
                <div
                  key={c.id}
                  className={`item item--sub ${isSel("cue", c.id) ? "is-selected" : ""}`}
                  style={{ left: c.start * pps, width: Math.max(3, (c.end - c.start) * pps) }}
                  title={c.text}
                  onPointerDown={(e) => {
                    onSelect({ kind: "cue", id: c.id });
                    onSeek(Math.min(c.start + 0.01, total));
                    begin({ type: "move-cue", id: c.id, x0: e.clientX, start0: c.start, end0: c.end }, e);
                  }}
                >
                  {(c.end - c.start) * pps > 30 && <span className="item__label">{c.text}</span>}
                  <div className="item__handle item__handle--l" onPointerDown={(e) => begin({ type: "cue-in", id: c.id, x0: e.clientX, start0: c.start, end0: c.end }, e)} />
                  <div className="item__handle item__handle--r" onPointerDown={(e) => begin({ type: "cue-out", id: c.id, x0: e.clientX, start0: c.start, end0: c.end }, e)} />
                </div>
              ))}
            </div>

            {markers.map((m, i) => (
              <div key={i} className="marker" style={{ left: m * pps }} />
            ))}
            <div className="playhead" style={{ left: time * pps }} />
          </div>
        </div>
      </div>
    </div>
  );
}
