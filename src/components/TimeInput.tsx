import { useState } from "react";
import { formatTime, parseTime } from "@/services/format";

/** Поле времени: показывает мм:сс.ммм, принимает «1:23.5», «83.5» и т.п. */
export function TimeInput({ value, onChange, min = 0, max, disabled, title }: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = (t: string) => {
    const v = parseTime(t);
    if (v !== null) {
      let x = Math.max(min, v);
      if (max !== undefined) x = Math.min(max, x);
      onChange(x);
    }
    setText(null);
  };
  return (
    <input
      className="input input--mono"
      title={title}
      disabled={disabled}
      value={text ?? formatTime(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(null);
      }}
    />
  );
}
