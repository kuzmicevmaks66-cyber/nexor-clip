import type { Cue, SubtitleStyle } from "@/types";
import { subtitleCss } from "./presets";

/** Субтитры поверх кадра — повторяют логику ASS-рендера (позиция, обводка, анимации). */
export function SubtitleLayer({ cues, style, time, frameHeight }: {
  cues: Cue[];
  style: SubtitleStyle;
  time: number;
  frameHeight: number;
}) {
  const cue = cues.find((c) => time >= c.start && time < c.end);
  if (!cue || !cue.text.trim()) return null;
  const css = subtitleCss(style, frameHeight);
  const anim = style.animation === "fade" ? "anim-fade" : style.animation === "pop" ? "anim-pop" : "";
  let body: React.ReactNode = cue.text;
  if (style.animation === "word") {
    const words = cue.text.trim().split(/\s+/);
    const totalChars = words.reduce((s, w) => s + Math.max(1, w.length), 0);
    const span = (cue.end - cue.start) * 0.85;
    let acc = 0;
    body = words.map((w, i) => {
      const at = cue.start + (acc / totalChars) * span;
      acc += Math.max(1, w.length);
      return (
        <span key={i} style={{ visibility: time >= at ? "visible" : "hidden" }}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      );
    });
  }
  return (
    <div className="sub-layer" style={css}>
      <span key={cue.id} className={anim}>
        {body}
      </span>
    </div>
  );
}
