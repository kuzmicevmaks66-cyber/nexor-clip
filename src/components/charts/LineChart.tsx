import { useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "@/services/format";

export interface ChartPoint {
  /** Время в мс (Date.getTime()). */
  t: number;
  v: number;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(+v.toFixed(10));
  return out;
}

const compact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")} млн` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1).replace(".0", "")} тыс` : String(Math.round(n));

/** Однорядный линейный график (одна серия, одна ось), с перекрестием и подсказкой. */
export function LineChart({
  points, height = 220, label, dateOnly = true, zeroBased = false,
}: { points: ChartPoint[]; height?: number; label: string; dateOnly?: boolean; zeroBased?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => [...points].sort((a, b) => a.t - b.t), [points]);
  const m = { l: 56, r: 16, t: 12, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  if (pts.length === 0) {
    return <div className="muted small" style={{ padding: "24px 0" }}>Нет данных для графика.</div>;
  }

  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs);
  const hi = Math.max(...vs);
  if (zeroBased) lo = Math.min(0, lo);
  const ticks = niceTicks(lo, hi);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t: number) => m.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const fmtDate = (t: number) =>
    new Date(t).toLocaleString("ru-RU", dateOnly ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const xTickCount = Math.min(pts.length, Math.max(2, Math.floor(iw / 90)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => pts[Math.round((i / Math.max(1, xTickCount - 1)) * (pts.length - 1))]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left + m.l;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    });
    setHover(best);
  };
  const hp = hover !== null ? pts[hover] : null;
  const last = pts[pts.length - 1];

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg className="chart" width={width} height={height} role="img" aria-label={`${label}: последнее значение ${formatNumber(last.v)}`}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line className="grid-line" x1={m.l} x2={width - m.r} y1={y(tv)} y2={y(tv)} />
            <text x={m.l - 8} y={y(tv)} textAnchor="end" dominantBaseline="middle">{compact(tv)}</text>
          </g>
        ))}
        {xTicks.map((p, i) => (
          <text key={i} x={x(p.t)} y={height - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{fmtDate(p.t)}</text>
        ))}
        <path d={path} fill="none" stroke="#ffffff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.length <= 40 && pts.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.v)} r={hover === i ? 5 : 3} fill="#ffffff" stroke="#111111" strokeWidth={2} />)}
        {pts.length > 40 && <circle cx={x(last.t)} cy={y(last.v)} r={4} fill="#ffffff" stroke="#111111" strokeWidth={2} />}
        {hp && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={m.t} y2={m.t + ih} stroke="#a0a0a0" strokeDasharray="3 3" />
            <circle cx={x(hp.t)} cy={y(hp.v)} r={5} fill="#ffffff" stroke="#111111" strokeWidth={2} />
          </>
        )}
        <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="chart-tooltip" style={{ left: x(hp.t), top: y(hp.v) }}>
          <div className="muted">{fmtDate(hp.t)}</div>
          <div><strong>{formatNumber(hp.v)}</strong> · {label}</div>
        </div>
      )}
    </div>
  );
}

/** Таблица значений — доступная альтернатива графику. */
export function ChartTable({ points, label, dateOnly = true }: { points: ChartPoint[]; label: string; dateOnly?: boolean }) {
  return (
    <div style={{ maxHeight: 240, overflowY: "auto" }}>
      <table className="table">
        <thead><tr><th>Дата</th><th style={{ textAlign: "right" }}>{label}</th></tr></thead>
        <tbody>
          {[...points].sort((a, b) => b.t - a.t).map((p) => (
            <tr key={p.t}>
              <td>{new Date(p.t).toLocaleString("ru-RU", dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="mono" style={{ textAlign: "right" }}>{formatNumber(p.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
