import { useState } from "react";
import { Play, Pause } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { formatTime, parseTime } from "@/services/format";

export interface Segment {
  start: number;
  end: number;
}

interface Props {
  current: number;
  duration: number;
  segment: Segment;
  onChange: (s: Segment) => void;
  previewing: boolean;
  onPreview: () => void;
  onStopPreview: () => void;
}

/** Ручной выбор временного отрезка: начало, конец, длительность, позиция, предпросмотр. */
export function SegmentPicker({ current, duration, segment, onChange, previewing, onPreview, onStopPreview }: Props) {
  const [startText, setStartText] = useState<string | null>(null);
  const [endText, setEndText] = useState<string | null>(null);
  const valid = segment.end > segment.start;
  const length = valid ? segment.end - segment.start : 0;

  const commit = (which: "start" | "end", text: string) => {
    const v = parseTime(text);
    if (v !== null) {
      const clamped = Math.min(Math.max(0, v), duration || v);
      onChange({ ...segment, [which]: clamped });
    }
    which === "start" ? setStartText(null) : setEndText(null);
  };

  const pct = (t: number) => (duration > 0 ? `${(t / duration) * 100}%` : "0%");

  return (
    <div className="stack">
      <div
        style={{ position: "relative", height: 10, background: "var(--bg-surface)", borderRadius: 5 }}
        aria-label="Выбранный интервал"
      >
        {valid && duration > 0 && (
          <div
            style={{
              position: "absolute",
              left: pct(segment.start),
              width: `${(length / duration) * 100}%`,
              top: 0,
              bottom: 0,
              background: "#ffffff",
              borderRadius: 5,
            }}
          />
        )}
        {duration > 0 && (
          <div
            style={{
              position: "absolute",
              left: pct(current),
              top: -4,
              bottom: -4,
              width: 2,
              background: "var(--text-secondary)",
            }}
          />
        )}
      </div>

      <div className="grid grid-2">
        <Field label="Начало">
          <div className="input-group">
            <input
              className="input input--mono"
              value={startText ?? formatTime(segment.start)}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={(e) => commit("start", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Button size="sm" onClick={() => onChange({ ...segment, start: current })} title="Взять текущую позицию">
              Сейчас
            </Button>
          </div>
        </Field>
        <Field label="Конец">
          <div className="input-group">
            <input
              className="input input--mono"
              value={endText ?? formatTime(segment.end)}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={(e) => commit("end", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <Button size="sm" onClick={() => onChange({ ...segment, end: current })} title="Взять текущую позицию">
              Сейчас
            </Button>
          </div>
        </Field>
      </div>

      <div className="row">
        <div>
          <div className="small muted">Продолжительность</div>
          <div className="timecode">{valid ? formatTime(length) : "—"}</div>
        </div>
        <div>
          <div className="small muted">Текущая позиция</div>
          <div className="timecode">{formatTime(current)}</div>
        </div>
        <div className="spacer" />
        {previewing ? (
          <Button icon={Pause} onClick={onStopPreview}>
            Остановить
          </Button>
        ) : (
          <Button variant="primary" icon={Play} disabled={!valid} onClick={onPreview}>
            Предпросмотр интервала
          </Button>
        )}
      </div>
      {!valid && <div className="small muted">Конец интервала должен быть позже начала.</div>}
    </div>
  );
}
