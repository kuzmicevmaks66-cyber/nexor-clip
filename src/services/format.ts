/** Форматирует секунды как HH:MM:SS.mmm (или MM:SS.mmm если меньше часа). */
export function formatTime(totalSeconds: number, withMs = true): string {
  const s = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000) % 1000;
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const base = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  return withMs ? `${base}.${pad(ms, 3)}` : base;
}

/** Разбирает «1:23», «01:02:03.5», «95» → секунды. Возвращает null при ошибке. */
export function parseTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    total = total * 60 + parseFloat(p);
  }
  return total;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
