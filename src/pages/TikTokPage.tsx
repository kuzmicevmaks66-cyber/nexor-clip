import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, Music, RefreshCw, ShieldCheck } from "lucide-react";
import type { PageProps } from "@/app/App";
import { Button, Card, EmptyState, ErrorNotice, Metric, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { ttConnect, ttDisconnect, ttIsConnected, ttUser, ttVideos, type TtUser, type TtVideo } from "@/services/tiktok";
import { lastUpdated } from "@/services/analytics";
import { getSettings, openExternal } from "@/services/system";
import { errorText, isDesktop } from "@/services/tauri";
import { formatNumber, formatTime } from "@/services/format";

export function TikTokPage({ navigate }: PageProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(false);
  const [user, setUser] = useState<TtUser | null>(null);
  const [videos, setVideos] = useState<TtVideo[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const u = await ttUser();
      setUser(u);
      if (u.grantedScopes.length === 0 || u.grantedScopes.includes("video.list")) {
        const page = await ttVideos(null);
        setVideos(page.videos);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      }
      setUpdated(await lastUpdated("tiktok", u.openId).catch(() => null));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop()) return setConnected(false);
    getSettings().then((s) => setConfigured(!!s.values["tiktok_client_key"] && !!s.secrets["tiktok_client_secret"])).catch(() => undefined);
    ttIsConnected()
      .then((c) => {
        setConnected(c);
        if (c) void load();
      })
      .catch(() => setConnected(false));
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ttConnect();
      setConnected(true);
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    try {
      await ttDisconnect();
    } catch (e) {
      setErr(errorText(e));
    }
    setConnected(false);
    setUser(null);
    setVideos([]);
  };
  const more = async () => {
    setBusy(true);
    try {
      const page = await ttVideos(cursor);
      setVideos((v) => [...v, ...page.videos]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const has = (s: string) => !user || user.grantedScopes.length === 0 || user.grantedScopes.includes(s);

  return (
    <div className="page">
      <PageHeader
        title="TikTok"
        description="Подключение через официальный TikTok Login Kit (OAuth). Показываются только данные, которые возвращает официальный API."
        actions={
          connected ? (
            <>
              <Button icon={RefreshCw} onClick={load} disabled={busy}>Обновить</Button>
              <Button icon={LogOut} onClick={disconnect}>Отключить</Button>
            </>
          ) : undefined
        }
      />
      <ErrorNotice error={err} onClose={() => setErr(null)} />

      {!connected ? (
        <Card>
          <EmptyState
            icon={Music}
            title="Аккаунт TikTok не подключён"
            text={
              !isDesktop()
                ? "Подключение доступно в desktop-приложении."
                : configured
                  ? "Откроется браузер со страницей входа TikTok. После подтверждения приложение получит доступ только к разрешённым данным."
                  : "Сначала укажите Client Key и Client Secret вашего приложения TikTok for Developers в Настройках."
            }
            action={
              isDesktop() ? (
                configured ? (
                  <Button variant="primary" icon={ShieldCheck} onClick={connect} disabled={busy}>{busy ? "Ожидание входа в браузере…" : "Войти через TikTok"}</Button>
                ) : (
                  <Button variant="primary" onClick={() => navigate("settings")}>Открыть настройки</Button>
                )
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {user && (
            <Card
              title={user.displayName ?? "Профиль"}
              subtitle={[user.username ? `@${user.username}` : null, updated ? `обновлено ${new Date(updated).toLocaleString("ru-RU")}` : null].filter(Boolean).join(" · ")}
              actions={user.profileLink ? <Button size="sm" icon={ExternalLink} onClick={() => openExternal(user.profileLink!)}>Профиль</Button> : undefined}
            >
              <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
                <div className="avatar avatar--lg">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Music size={24} />}</div>
                <div className="stack" style={{ flex: 1 }}>
                  {user.bio && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{user.bio}</div>}
                  <div className="metrics">
                    <Metric label="Подписчики" value={user.followers} />
                    <Metric label="Подписки" value={user.following} />
                    <Metric label="Лайки (всего)" value={user.likes} />
                    <Metric label="Видео" value={user.videos} />
                  </div>
                  <div className="row small muted">
                    <StatusBadge on={has("user.info.stats")} label="user.info.stats" />
                    <StatusBadge on={has("video.list")} label="video.list" />
                    <StatusBadge on={user.grantedScopes.includes("video.publish")} label="video.publish" />
                  </div>
                </div>
              </div>
            </Card>
          )}
          <Card title="Видео" subtitle="TikTok Display API · video.list">
            {!has("video.list") ? (
              <Notice>Разрешение video.list не выдано — список видео недоступно через API. Переподключите аккаунт.</Notice>
            ) : videos.length === 0 ? (
              <div className="muted small">{busy ? "Загрузка…" : "Видео не найдены."}</div>
            ) : (
              <div className="stack">
                <table className="table">
                  <thead>
                    <tr><th>Видео</th><th>Дата</th><th style={{ textAlign: "right" }}>Просмотры</th><th style={{ textAlign: "right" }}>Лайки</th><th style={{ textAlign: "right" }}>Комментарии</th><th style={{ textAlign: "right" }}>Репосты</th></tr>
                  </thead>
                  <tbody>
                    {videos.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <div className="row" style={{ flexWrap: "nowrap" }}>
                            <div className="result__thumb" style={{ width: 48, aspectRatio: "9/16" }}>{v.cover ? <img src={v.cover} alt="" /> : <Music size={14} />}</div>
                            <div style={{ minWidth: 0 }}>
                              {v.shareUrl ? <button type="button" className="link" onClick={() => openExternal(v.shareUrl!)}>{v.title || v.description || "Без названия"}</button> : v.title || "Без названия"}
                              {v.duration ? <div className="small muted">{formatTime(v.duration, false)}</div> : null}
                            </div>
                          </div>
                        </td>
                        <td>{v.createTime ? new Date(v.createTime * 1000).toLocaleDateString("ru-RU") : "—"}</td>
                        {[v.views, v.likes, v.comments, v.shares].map((n, i) => (
                          <td key={i} className="mono" style={{ textAlign: "right" }}>{n === null ? <span className="muted small">Недоступно через API</span> : formatNumber(n)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasMore && <div><Button onClick={more} disabled={busy}>Загрузить ещё</Button></div>}
              </div>
            )}
          </Card>
          <Notice>
            Время просмотра, удержание, демография и источники трафика официальным TikTok Display API не предоставляются —
            поэтому в приложении их нет. Динамика подписчиков строится из ваших локальных снимков в разделе «Аналитика».
          </Notice>
        </>
      )}
    </div>
  );
}
