import { useCallback, useEffect, useRef, useState } from "react";
import { BookmarkPlus, ChartColumn, ExternalLink, Link, MonitorPlay, Search, Trash2, Users } from "lucide-react";
import type { PageProps } from "@/app/App";
import { Button, Card, EmptyState, ErrorNotice, Notice, PageHeader, Segmented } from "@/components/ui";
import { SegmentPicker, type Segment } from "@/features/youtube/SegmentPicker";
import { extractVideoId, loadYouTubeApi, YT_ERRORS, type YTPlayer } from "@/features/youtube/youtubePlayer";
import { useProject } from "@/features/projects/ProjectContext";
import {
  decodeEntities, isoDuration, ytChannelVideos, ytSearch, ytVideoDetails, type YtChannel, type YtVideo,
} from "@/services/youtube";
import { getSettings, openExternal, setSetting } from "@/services/system";
import { errorText, isDesktop, newId } from "@/services/tauri";
import { formatNumber, formatTime } from "@/services/format";

type SearchMode = "video" | "channel";

const ORDERS = [
  { value: "relevance", label: "По релевантности" },
  { value: "date", label: "Сначала новые" },
  { value: "viewCount", label: "По просмотрам" },
  { value: "rating", label: "По рейтингу" },
];

export async function readTrackedChannels(): Promise<string[]> {
  try {
    const s = await getSettings();
    const raw = s.values["tracked_channels"];
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export const writeTrackedChannels = (ids: string[]) => setSetting("tracked_channels", JSON.stringify([...new Set(ids)]));

function VideoRow({ v, active, onOpen }: { v: YtVideo; active: boolean; onOpen: () => void }) {
  const dur = isoDuration(v.duration);
  return (
    <button type="button" className={`result ${active ? "is-active" : ""}`} onClick={onOpen}>
      <div className="result__thumb">
        {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" /> : <MonitorPlay size={20} />}
        {dur !== null && <span className="media-tile__badge">{formatTime(dur, false)}</span>}
      </div>
      <div className="result__body">
        <span className="result__title">{decodeEntities(v.title)}</span>
        <span className="result__meta">{decodeEntities(v.channelTitle)}</span>
        <span className="result__meta">
          {v.views !== null ? `${formatNumber(v.views)} просмотров` : "Просмотры скрыты"}
          {v.publishedAt ? ` · ${new Date(v.publishedAt).toLocaleDateString("ru-RU")}` : ""}
        </span>
      </div>
    </button>
  );
}

function ChannelRow({ c, tracked, onTrack, onVideos }: { c: YtChannel; tracked: boolean; onTrack: () => void; onVideos: () => void }) {
  return (
    <div className="result">
      <div className="avatar">{c.thumbnail ? <img src={c.thumbnail} alt="" /> : <Users size={18} />}</div>
      <div className="result__body">
        <span className="result__title">{decodeEntities(c.title)}</span>
        <span className="result__meta">
          {c.hiddenSubscribers || c.subscribers === null ? "Подписчики скрыты владельцем" : `${formatNumber(c.subscribers)} подписчиков`}
          {c.videos !== null ? ` · ${formatNumber(c.videos)} видео` : ""}
        </span>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <Button size="sm" onClick={onVideos}>Видео канала</Button>
          <Button size="sm" icon={ChartColumn} onClick={onTrack} disabled={tracked}>
            {tracked ? "Отслеживается" : "Отслеживать"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function YouTubePage({ navigate }: PageProps) {
  const { project, update, ensure } = useProject();
  const [mode, setMode] = useState<SearchMode>("video");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState("relevance");
  const [videos, setVideos] = useState<YtVideo[]>([]);
  const [channels, setChannels] = useState<YtChannel[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [listTitle, setListTitle] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [tracked, setTracked] = useState<string[]>([]);

  const [linkInput, setLinkInput] = useState("");
  const [video, setVideo] = useState<{ id: string; title: string; channelTitle?: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [segment, setSegment] = useState<Segment>({ start: 0, end: 0 });
  const [previewing, setPreviewing] = useState(false);
  const segmentRef = useRef(segment);
  segmentRef.current = segment;
  const previewRef = useRef(previewing);
  previewRef.current = previewing;

  useEffect(() => {
    if (isDesktop()) readTrackedChannels().then(setTracked);
  }, []);

  const runSearch = async (more = false) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const r = await ytSearch(query.trim(), mode, more ? nextToken : null, order);
      setListTitle(null);
      if (mode === "video") setVideos((v) => (more ? [...v, ...r.videos] : r.videos));
      else setChannels((c) => (more ? [...c, ...r.channels] : r.channels));
      if (!more) mode === "video" ? setChannels([]) : setVideos([]);
      setNextToken(r.nextPageToken);
    } catch (e) {
      setSearchErr(errorText(e));
    } finally {
      setSearching(false);
    }
  };

  const showChannelVideos = async (c: YtChannel) => {
    setSearching(true);
    setSearchErr(null);
    try {
      const list = await ytChannelVideos(c.id);
      setVideos(list);
      setChannels([]);
      setNextToken(null);
      setMode("video");
      setListTitle(`Последние видео канала «${decodeEntities(c.title)}»`);
    } catch (e) {
      setSearchErr(errorText(e));
    } finally {
      setSearching(false);
    }
  };

  const track = async (id: string) => {
    const next = [...tracked, id];
    try {
      await writeTrackedChannels(next);
      setTracked(next);
    } catch (e) {
      setSearchErr(errorText(e));
    }
  };

  const openVideo = (v: { id: string; title: string; channelTitle?: string }) => {
    setLinkError(null);
    setSaved(null);
    setVideo(v);
  };

  const openLink = async () => {
    const id = extractVideoId(linkInput);
    if (!id) {
      setLinkError("Не удалось распознать ссылку. Поддерживаются youtube.com/watch, youtu.be, /shorts/ и ID видео.");
      return;
    }
    openVideo({ id, title: `Видео ${id}` });
    if (isDesktop()) {
      // Название подтягиваем через Data API, если ключ указан; без ключа плеер всё равно работает.
      ytVideoDetails(id)
        .then((d) => setVideo((cur) => (cur && cur.id === id ? { id, title: decodeEntities(d.title), channelTitle: decodeEntities(d.channelTitle) } : cur)))
        .catch(() => undefined);
    }
  };

  // Официальный плеер YouTube IFrame Player API.
  useEffect(() => {
    const videoId = video?.id;
    if (!videoId || !hostRef.current) return;
    let cancelled = false;
    setPlayerError(null);
    setDuration(0);
    setCurrent(0);
    setPreviewing(false);
    const mount = document.createElement("div");
    hostRef.current.innerHTML = "";
    hostRef.current.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: (e) => {
              const d = e.target.getDuration();
              setDuration(d);
              setSegment({ start: 0, end: Math.min(d, 60) });
            },
            onError: (e) => setPlayerError(YT_ERRORS[e.data] ?? `Ошибка плеера (${e.data}).`),
          },
        });
      })
      .catch((e: Error) => setPlayerError(e.message));
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [video?.id]);

  useEffect(() => {
    if (!video) return;
    const t = window.setInterval(() => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== "function") return;
      const now = p.getCurrentTime();
      setCurrent(now);
      if (previewRef.current && now >= segmentRef.current.end) {
        p.pauseVideo();
        setPreviewing(false);
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [video]);

  const startPreview = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(segment.start, true);
    p.playVideo();
    setPreviewing(true);
  }, [segment.start]);
  const stopPreview = useCallback(() => {
    playerRef.current?.pauseVideo();
    setPreviewing(false);
  }, []);

  const saveSegment = async () => {
    if (!video || segment.end <= segment.start) return;
    try {
      await ensure("YouTube-фрагменты");
      update((d) => ({
        ...d,
        youtube: [
          ...d.youtube,
          {
            id: newId(),
            videoId: video.id,
            title: video.title,
            channelTitle: video.channelTitle,
            start: segment.start,
            end: segment.end,
            savedAt: new Date().toISOString(),
          },
        ],
      }));
      setSaved(`Фрагмент ${formatTime(segment.start, false)}–${formatTime(segment.end, false)} сохранён в проект.`);
    } catch (e) {
      setSaved(errorText(e));
    }
  };

  const seekTo = (t: number) => playerRef.current?.seekTo(t, true);
  const watchUrl = (id: string, t = 0) => `https://www.youtube.com/watch?v=${id}${t > 0 ? `&t=${Math.floor(t)}s` : ""}`;

  return (
    <div className="page">
      <PageHeader
        title="YouTube"
        description="Поиск через YouTube Data API v3, просмотр только через официальный YouTube IFrame Player и ручной выбор фрагментов."
      />

      <Card title="Поиск" subtitle="YouTube Data API v3 (ключ хранится в backend, раздел «Настройки»)">
        <div className="stack">
          <div className="row">
            <Segmented<SearchMode>
              value={mode}
              onChange={setMode}
              options={[{ value: "video", label: "Видео" }, { value: "channel", label: "Каналы" }]}
            />
            <div className="input-group" style={{ flex: 1, minWidth: 260 }}>
              <input
                className="input"
                value={query}
                disabled={!isDesktop()}
                placeholder={mode === "video" ? "Название или ключевые слова…" : "Название канала…"}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <Button variant="primary" icon={Search} onClick={() => runSearch()} disabled={!query.trim() || searching || !isDesktop()}>
                {searching ? "Поиск…" : "Найти"}
              </Button>
            </div>
            {mode === "video" && (
              <select className="select" style={{ width: 200 }} value={order} onChange={(e) => setOrder(e.target.value)}>
                {ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
          {!isDesktop() && <Notice>Поиск работает в desktop-приложении: запросы к API выполняет backend.</Notice>}
          <ErrorNotice error={searchErr} onClose={() => setSearchErr(null)} />
          {searchErr && /ключ|key/i.test(searchErr) && (
            <div className="small">
              <a href="#/settings" onClick={() => navigate("settings")} className="link">Указать ключ YouTube Data API в Настройках</a>
            </div>
          )}
          {listTitle && <div className="small muted">{listTitle}</div>}
          {(videos.length > 0 || channels.length > 0) && (
            <div className="result-grid">
              {videos.map((v) => (
                <VideoRow key={v.id} v={v} active={video?.id === v.id} onOpen={() => openVideo({ id: v.id, title: decodeEntities(v.title), channelTitle: decodeEntities(v.channelTitle) })} />
              ))}
              {channels.map((c) => (
                <ChannelRow key={c.id} c={c} tracked={tracked.includes(c.id)} onTrack={() => track(c.id)} onVideos={() => showChannelVideos(c)} />
              ))}
            </div>
          )}
          {nextToken && (
            <div>
              <Button onClick={() => runSearch(true)} disabled={searching}>Показать ещё</Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-sidebar">
        <Card title={video ? video.title : "Плеер"} subtitle={video?.channelTitle ?? "Официальный YouTube IFrame Player"}>
          <div className="stack">
            <div className="input-group">
              <input
                className="input"
                placeholder="Вставьте ссылку на видео YouTube или ID"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && openLink()}
              />
              <Button variant="primary" icon={Link} onClick={openLink} disabled={!linkInput.trim()}>Открыть</Button>
            </div>
            {linkError && <div className="small muted">{linkError}</div>}
            <div className="viewer">
              {video ? (
                <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
              ) : (
                <EmptyState icon={MonitorPlay} title="Видео не выбрано" text="Найдите видео или вставьте ссылку выше." />
              )}
            </div>
            {playerError && <Notice>{playerError}</Notice>}
            {video && isDesktop() && (
              <div>
                <Button size="sm" icon={ExternalLink} onClick={() => openExternal(watchUrl(video.id)).catch(() => undefined)}>
                  Открыть на YouTube
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Фрагмент" subtitle="Ручной выбор интервала">
          {video && duration > 0 ? (
            <div className="stack">
              <SegmentPicker
                current={current}
                duration={duration}
                segment={segment}
                onChange={setSegment}
                previewing={previewing}
                onPreview={startPreview}
                onStopPreview={stopPreview}
              />
              <hr className="divider" />
              <Button variant="primary" icon={BookmarkPlus} onClick={saveSegment} disabled={segment.end <= segment.start || !isDesktop()}>
                Сохранить в проект
              </Button>
              <div className="small muted">
                Сохраняется ссылка и интервал. Видео не скачивается — использовать его можно только в рамках правил YouTube.
                {project ? ` Проект: «${project.name}».` : " Будет создан новый проект."}
              </div>
              {saved && <Notice>{saved}</Notice>}
            </div>
          ) : (
            <div className="muted small">Откройте видео, чтобы выбрать начало и конец фрагмента.</div>
          )}
        </Card>
      </div>

      {project && project.data.youtube.length > 0 && (
        <Card title="Сохранённые фрагменты проекта" subtitle={project.name}>
          <table className="table">
            <thead>
              <tr><th>Видео</th><th>Начало</th><th>Конец</th><th>Длительность</th><th /></tr>
            </thead>
            <tbody>
              {project.data.youtube.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="link" onClick={() => { openVideo({ id: s.videoId, title: s.title, channelTitle: s.channelTitle }); }}>
                      {s.title}
                    </button>
                    {s.channelTitle && <div className="small muted">{s.channelTitle}</div>}
                  </td>
                  <td className="mono">
                    <button type="button" className="link" onClick={() => (video?.id === s.videoId ? seekTo(s.start) : openVideo({ id: s.videoId, title: s.title }))}>
                      {formatTime(s.start, false)}
                    </button>
                  </td>
                  <td className="mono">{formatTime(s.end, false)}</td>
                  <td className="mono">{formatTime(s.end - s.start, false)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button size="sm" iconOnly icon={ExternalLink} title="Открыть на YouTube с начала фрагмента" onClick={() => openExternal(watchUrl(s.videoId, s.start)).catch(() => undefined)} />
                    <Button size="sm" iconOnly icon={Trash2} title="Удалить из проекта" onClick={() => update((d) => ({ ...d, youtube: d.youtube.filter((x) => x.id !== s.id) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
