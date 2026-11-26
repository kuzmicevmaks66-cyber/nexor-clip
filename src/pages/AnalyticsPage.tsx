import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChartColumn, LogOut, MonitorPlay, Music, RefreshCw, ShieldCheck, Table2, Trash2, Users } from "lucide-react";
import type { PageProps } from "@/app/App";
import { Button, Card, EmptyState, ErrorNotice, Metric, Notice, PageHeader, Segmented } from "@/components/ui";
import { ChartTable, LineChart, type ChartPoint } from "@/components/charts/LineChart";
import {
  decodeEntities, ytAnalytics, ytChannels, ytConnect, ytDisconnect, ytIsConnected, ytMyChannel, ytMyVideos, ytVideoTotals,
  type AnalyticsReport, type YtChannel, type YtVideo,
} from "@/services/youtube";
import { ttIsConnected, ttUser, type TtUser } from "@/services/tiktok";
import { lastUpdated, metricHistory } from "@/services/analytics";
import { getSettings } from "@/services/system";
import { errorText, isDesktop } from "@/services/tauri";
import { formatNumber } from "@/services/format";
import { readTrackedChannels, writeTrackedChannels } from "./YouTubePage";

type Range = "7" | "28" | "90" | "365";
const METRIC_LABELS: Record<string, string> = {
  views: "Просмотры",
  likes: "Лайки",
  comments: "Комментарии",
  shares: "Репосты",
  subscribersGained: "Новые подписчики",
  subscribersLost: "Отписки",
  estimatedMinutesWatched: "Минуты просмотра",
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function rangeDates(r: Range) {
  // YouTube Analytics обновляется с задержкой ~2 дня.
  const end = new Date(Date.now() - 2 * 864e5);
  const start = new Date(end.getTime() - (+r - 1) * 864e5);
  return { start: ymd(start), end: ymd(end) };
}
const toPoints = (rep: AnalyticsReport | null, metric: string): ChartPoint[] => {
  if (!rep) return [];
  const di = rep.columns.indexOf("day");
  const mi = rep.columns.indexOf(metric);
  if (di < 0 || mi < 0) return [];
  return rep.rows.map((r) => ({ t: new Date(String(r[di]) + "T00:00:00").getTime(), v: Number(r[mi]) || 0 }));
};
const sum = (p: ChartPoint[]) => p.reduce((s, x) => s + x.v, 0);

function ReportChart({ report, title }: { report: AnalyticsReport | null; title: string }) {
  const metrics = report ? report.columns.filter((c) => c !== "day") : [];
  const [metric, setMetric] = useState("views");
  const [table, setTable] = useState(false);
  const pts = useMemo(() => toPoints(report, metric), [report, metric]);
  if (!report) return null;
  return (
    <Card
      title={title}
      subtitle={`${METRIC_LABELS[metric] ?? metric} по дням · итого ${formatNumber(sum(pts))}`}
      actions={<Button size="sm" icon={Table2} onClick={() => setTable((t) => !t)}>{table ? "График" : "Таблица"}</Button>}
    >
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          {metrics.map((m) => (
            <button key={m} type="button" className={`chip ${m === metric ? "is-active" : ""}`} onClick={() => setMetric(m)}>
              {METRIC_LABELS[m] ?? m}
            </button>
          ))}
          {report.unavailable.map((m) => (
            <span key={m} className="chip" style={{ opacity: 0.5, cursor: "default" }} title="Недоступно через API для этого отчёта">
              {METRIC_LABELS[m] ?? m}: недоступно через API
            </span>
          ))}
        </div>
        {report.rows.length === 0 ? (
          <div className="muted small">За выбранный период данных нет.</div>
        ) : table ? (
          <ChartTable points={pts} label={METRIC_LABELS[metric] ?? metric} />
        ) : (
          <LineChart points={pts} label={METRIC_LABELS[metric] ?? metric} zeroBased />
        )}
      </div>
    </Card>
  );
}

function HistoryChart({ platform, entityId, metric, label }: { platform: string; entityId: string; metric: string; label: string }) {
  const [pts, setPts] = useState<ChartPoint[] | null>(null);
  useEffect(() => {
    metricHistory(platform, entityId, metric)
      .then((h) => setPts(h.map((p) => ({ t: new Date(p.at).getTime(), v: p.value }))))
      .catch(() => setPts([]));
  }, [platform, entityId, metric]);
  if (!pts) return null;
  if (pts.length < 2)
    return <div className="small muted">История «{label}» накапливается локально при каждом обновлении. Сейчас снимков: {pts.length}.</div>;
  return <LineChart points={pts} label={label} dateOnly={false} />;
}

function VideoDetail({ v, onBack }: { v: YtVideo; onBack: () => void }) {
  const [totals, setTotals] = useState<Record<string, number | null> | null>(null);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("28");
  useEffect(() => {
    if (v.publishedAt) ytVideoTotals(v.id, v.publishedAt).then(setTotals).catch((e) => setErr(errorText(e)));
  }, [v.id, v.publishedAt]);
  useEffect(() => {
    const { start, end } = rangeDates(range);
    ytAnalytics(start, end, v.id).then(setReport).catch((e) => setErr(errorText(e)));
  }, [v.id, range]);
  const t = (k: string) => (totals && typeof totals[k] === "number" ? (totals[k] as number) : null);
  return (
    <div className="stack">
      <div><Button size="sm" icon={ArrowLeft} onClick={onBack}>К каналу</Button></div>
      <Card title={decodeEntities(v.title)} subtitle={v.publishedAt ? `Опубликовано ${new Date(v.publishedAt).toLocaleString("ru-RU")}` : undefined}>
        <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
          {v.thumbnail && <img src={v.thumbnail} alt="" style={{ width: 260, borderRadius: 8, aspectRatio: "16/9", objectFit: "cover" }} />}
          <div className="metrics" style={{ flex: 1 }}>
            <Metric label="Просмотры" value={v.views} />
            <Metric label="Лайки" value={v.likes} />
            <Metric label="Комментарии" value={v.comments} />
            <Metric label="Репосты" value={totals ? t("shares") : undefined} />
            <Metric label="Новые подписчики" value={totals ? t("subscribersGained") : undefined} />
          </div>
        </div>
        {!totals && !err && <div className="small muted">Загрузка данных YouTube Analytics…</div>}
      </Card>
      <ErrorNotice error={err} onClose={() => setErr(null)} />
      <div className="row">
        <Segmented<Range> value={range} onChange={setRange} options={[{ value: "7", label: "7 дней" }, { value: "28", label: "28 дней" }, { value: "90", label: "90 дней" }, { value: "365", label: "Год" }]} />
      </div>
      <ReportChart report={report} title="Динамика видео" />
    </div>
  );
}

export function AnalyticsPage({ navigate }: PageProps) {
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  const [ytConfigured, setYtConfigured] = useState(false);
  const [channel, setChannel] = useState<YtChannel | null>(null);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [videos, setVideos] = useState<YtVideo[]>([]);
  const [videosToken, setVideosToken] = useState<string | null>(null);
  const [video, setVideo] = useState<YtVideo | null>(null);
  const [range, setRange] = useState<Range>("28");
  const [tracked, setTracked] = useState<YtChannel[]>([]);
  const [tt, setTt] = useState<TtUser | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!isDesktop()) return;
    setBusy(true);
    setErr(null);
    const errors: string[] = [];
    try {
      const s = await getSettings();
      setYtConfigured(!!s.values["youtube_client_id"] && !!s.secrets["youtube_client_secret"]);
      const conn = await ytIsConnected();
      setYtConnected(conn);
      if (conn) {
        try {
          const ch = await ytMyChannel();
          setChannel(ch);
          const { start, end } = rangeDates(range);
          setReport(await ytAnalytics(start, end));
          const [list, token] = await ytMyVideos(null);
          setVideos(list);
          setVideosToken(token);
          setUpdated(await lastUpdated("youtube", ch.id));
        } catch (e) {
          errors.push(`YouTube: ${errorText(e)}`);
        }
      }
      const ids = await readTrackedChannels();
      if (ids.length) {
        try {
          setTracked(await ytChannels(ids));
        } catch (e) {
          errors.push(`Отслеживаемые каналы: ${errorText(e)}`);
        }
      } else setTracked([]);
      if (await ttIsConnected().catch(() => false)) {
        try {
          setTt(await ttUser());
        } catch (e) {
          errors.push(`TikTok: ${errorText(e)}`);
        }
      } else setTt(null);
    } catch (e) {
      errors.push(errorText(e));
    } finally {
      setErr(errors.length ? errors.join("\n") : null);
      setBusy(false);
      setTick((t) => t + 1);
    }
  }, [range]);

  useEffect(() => void refresh(), [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      await ytConnect();
      await refresh();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };
  const disconnect = async () => {
    await ytDisconnect().catch((e) => setErr(errorText(e)));
    setYtConnected(false);
    setChannel(null);
    setReport(null);
    setVideos([]);
  };
  const untrack = async (id: string) => {
    const ids = (await readTrackedChannels()).filter((x) => x !== id);
    await writeTrackedChannels(ids);
    setTracked((t) => t.filter((c) => c.id !== id));
  };
  const moreVideos = async () => {
    try {
      const [list, token] = await ytMyVideos(videosToken);
      setVideos((v) => [...v, ...list]);
      setVideosToken(token);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Аналитика"
        description="Официальные YouTube Data API v3, YouTube Analytics API и TikTok Display API. История значений сохраняется локально при каждом обновлении."
        actions={
          <>
            {updated && <span className="small muted">Обновлено: {new Date(updated).toLocaleString("ru-RU")}</span>}
            <Button variant="primary" icon={RefreshCw} onClick={refresh} disabled={busy || !isDesktop()}>{busy ? "Обновление…" : "Обновить"}</Button>
          </>
        }
      />
      {!isDesktop() && <Notice>Аналитика доступна в desktop-приложении — запросы к API выполняет backend.</Notice>}
      <ErrorNotice error={err} onClose={() => setErr(null)} />

      {video ? (
        <VideoDetail v={video} onBack={() => setVideo(null)} />
      ) : (
        <>
          {ytConnected === false && isDesktop() && (
            <Card>
              <EmptyState
                icon={MonitorPlay}
                title="Канал YouTube не подключён"
                text={ytConfigured ? "Вход через Google OAuth в браузере. Приложение запросит только чтение данных канала и аналитики (и загрузку — только по вашей команде)." : "Укажите OAuth Client ID и Client Secret Google Cloud в Настройках."}
                action={ytConfigured ? <Button variant="primary" icon={ShieldCheck} onClick={connect} disabled={busy}>Подключить YouTube</Button> : <Button variant="primary" onClick={() => navigate("settings")}>Открыть настройки</Button>}
              />
            </Card>
          )}

          {channel && (
            <Card
              title={decodeEntities(channel.title)}
              subtitle={channel.customUrl ?? "Мой канал"}
              actions={<Button size="sm" icon={LogOut} onClick={disconnect}>Отключить</Button>}
            >
              <div className="stack">
                <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
                  <div className="avatar avatar--lg">{channel.thumbnail ? <img src={channel.thumbnail} alt="" /> : <Users size={24} />}</div>
                  <div className="metrics" style={{ flex: 1 }}>
                    <Metric label="Подписчики" value={channel.hiddenSubscribers ? null : channel.subscribers} />
                    <Metric label="Просмотры (всего)" value={channel.views} />
                    <Metric label="Видео" value={channel.videos} />
                  </div>
                </div>
                <HistoryChart key={`s-${tick}`} platform="youtube" entityId={channel.id} metric="subscribers" label="Подписчики" />
              </div>
            </Card>
          )}

          {channel && (
            <>
              <div className="row">
                <Segmented<Range> value={range} onChange={setRange} options={[{ value: "7", label: "7 дней" }, { value: "28", label: "28 дней" }, { value: "90", label: "90 дней" }, { value: "365", label: "Год" }]} />
                <span className="small muted">Данные YouTube Analytics поступают с задержкой около 2 дней.</span>
              </div>
              <ReportChart report={report} title="Динамика канала" />
              <Card title="Мои видео" subtitle="Нажмите на видео, чтобы открыть его статистику">
                {videos.length === 0 ? (
                  <div className="muted small">Видео не найдены.</div>
                ) : (
                  <div className="stack">
                    <table className="table">
                      <thead>
                        <tr><th>Видео</th><th>Дата</th><th style={{ textAlign: "right" }}>Просмотры</th><th style={{ textAlign: "right" }}>Лайки</th><th style={{ textAlign: "right" }}>Комментарии</th></tr>
                      </thead>
                      <tbody>
                        {videos.map((v) => (
                          <tr key={v.id}>
                            <td>
                              <div className="row" style={{ flexWrap: "nowrap" }}>
                                <div className="result__thumb" style={{ width: 80 }}>{v.thumbnail ? <img src={v.thumbnail} alt="" /> : <MonitorPlay size={14} />}</div>
                                <button type="button" className="link" onClick={() => setVideo(v)}>{decodeEntities(v.title)}</button>
                              </div>
                            </td>
                            <td>{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString("ru-RU") : "—"}</td>
                            {[v.views, v.likes, v.comments].map((n, i) => (
                              <td key={i} className="mono" style={{ textAlign: "right" }}>{n === null ? <span className="muted small">Недоступно через API</span> : formatNumber(n)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {videosToken && <div><Button onClick={moreVideos}>Загрузить ещё</Button></div>}
                  </div>
                )}
              </Card>
            </>
          )}

          <Card title="Отслеживаемые каналы YouTube" subtitle="Публичные данные через YouTube Data API v3 (нужен API-ключ)">
            {tracked.length === 0 ? (
              <div className="small muted">
                Каналов нет. Найдите канал в разделе <a href="#/youtube" className="link">YouTube</a> и нажмите «Отслеживать».
              </div>
            ) : (
              <div className="stack">
                {tracked.map((c) => (
                  <div key={c.id} className="stack" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
                    <div className="row">
                      <div className="avatar">{c.thumbnail ? <img src={c.thumbnail} alt="" /> : <Users size={18} />}</div>
                      <strong style={{ flex: 1 }}>{decodeEntities(c.title)}</strong>
                      <Button size="sm" iconOnly icon={Trash2} title="Перестать отслеживать" onClick={() => untrack(c.id)} />
                    </div>
                    <div className="metrics">
                      <Metric label="Подписчики" value={c.hiddenSubscribers ? null : c.subscribers} />
                      <Metric label="Просмотры" value={c.views} />
                      <Metric label="Видео" value={c.videos} />
                    </div>
                    <HistoryChart key={`${c.id}-${tick}`} platform="youtube" entityId={c.id} metric={c.hiddenSubscribers ? "views" : "subscribers"} label={c.hiddenSubscribers ? "Просмотры" : "Подписчики"} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="TikTok" subtitle="TikTok Display API">
            {tt ? (
              <div className="stack">
                <div className="metrics">
                  <Metric label="Подписчики" value={tt.followers} />
                  <Metric label="Лайки" value={tt.likes} />
                  <Metric label="Видео" value={tt.videos} />
                </div>
                <HistoryChart key={`tt-${tick}`} platform="tiktok" entityId={tt.openId} metric="followers" label="Подписчики TikTok" />
              </div>
            ) : (
              <div className="row small muted">
                <Music size={14} /> Аккаунт TikTok не подключён.
                <Button size="sm" onClick={() => navigate("tiktok")}>Подключить</Button>
              </div>
            )}
          </Card>
          {!channel && !tracked.length && !tt && ytConnected !== null && (
            <EmptyState icon={ChartColumn} title="Нет источников данных" text="Подключите YouTube или TikTok, либо добавьте канал для отслеживания." />
          )}
        </>
      )}
    </div>
  );
}
