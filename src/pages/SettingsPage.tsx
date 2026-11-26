import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Database, ExternalLink, FolderOpen, HardDrive, Info, KeyRound, Music, MonitorPlay, Captions, Trash2, Wrench, User } from "lucide-react";
import type { PageProps } from "@/app/App";
import type { DataUsage, FfmpegStatus, SettingsView, WhisperStatus } from "@/types";
import { Button, Card, ErrorNotice, Field, Notice, PageHeader, StatusBadge, Toggle } from "@/components/ui";
import {
  APP_VERSION, checkFfmpeg, clearAnalyticsHistory, clearCache, dataUsage, getSettings, openExternal, pickExecutable, pickFolder,
  pickModelFile, resetCounters, revealPath, setSecret, setSetting, whisperStatus,
} from "@/services/system";
import { ytConnect, ytDisconnect, ytIsConnected } from "@/services/youtube";
import { ttConnect, ttDisconnect, ttIsConnected } from "@/services/tiktok";
import { errorText, isDesktop } from "@/services/tauri";
import { formatBytes } from "@/services/format";

/** Поле настройки, сохраняемое по потере фокуса. */
function SettingInput({ k, view, onSaved, placeholder, type = "text" }: { k: string; view: SettingsView; onSaved: () => void; placeholder?: string; type?: string }) {
  const [v, setV] = useState(view.values[k] ?? "");
  useEffect(() => setV(view.values[k] ?? ""), [view, k]);
  return (
    <input
      className="input"
      type={type}
      value={v}
      placeholder={placeholder ?? view.defaults[k]}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (view.values[k] ?? "") && setSetting(k, v).then(onSaved)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PathSetting({ k, view, onSaved, pick, placeholder }: { k: string; view: SettingsView; onSaved: () => void; pick: () => Promise<string | null>; placeholder?: string }) {
  return (
    <div className="input-group">
      <SettingInput k={k} view={view} onSaved={onSaved} placeholder={placeholder} />
      <Button icon={FolderOpen} onClick={async () => { const p = await pick(); if (p) { await setSetting(k, p); onSaved(); } }}>Обзор</Button>
      {view.values[k] && <Button iconOnly icon={Trash2} title="Сбросить" onClick={async () => { await setSetting(k, ""); onSaved(); }} />}
    </div>
  );
}

/** Ввод секрета: значение уходит в backend (Windows Credential Manager) и обратно не читается. */
function SecretInput({ name, view, onSaved, label }: { name: string; view: SettingsView; onSaved: () => void; label: string }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const has = !!view.secrets[name];
  const save = async (val: string) => {
    try {
      await setSecret(name, val);
      setV("");
      setErr(null);
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <Field label={label} hint={has ? "Сохранено в Windows Credential Manager. Введите новое значение, чтобы заменить." : "Хранится в Windows Credential Manager, не в файлах приложения."}>
      <div className="input-group">
        <input className="input" type="password" autoComplete="off" value={v} placeholder={has ? "••••••••••••  (сохранено)" : "Не задано"} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v.trim() && save(v)} />
        <Button variant="primary" disabled={!v.trim()} onClick={() => save(v)}>Сохранить</Button>
        {has && <Button iconOnly icon={Trash2} title="Удалить" onClick={() => save("")} />}
      </div>
      <ErrorNotice error={err} />
    </Field>
  );
}

function Section({ icon: Icon, title, subtitle, children }: { icon: typeof Info; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon size={16} /> {title}</span>} subtitle={subtitle}>
      <div className="stack">{children}</div>
    </Card>
  );
}

export function SettingsPage({ appInfo }: PageProps) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [ff, setFf] = useState<FfmpegStatus | null>(null);
  const [ws, setWs] = useState<WhisperStatus | null>(null);
  const [usage, setUsage] = useState<DataUsage | null>(null);
  const [yt, setYt] = useState(false);
  const [tt, setTt] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const [v, f, w, u, y, t] = await Promise.all([
        getSettings(), checkFfmpeg(), whisperStatus(), dataUsage(), ytIsConnected().catch(() => false), ttIsConnected().catch(() => false),
      ]);
      setView(v); setFf(f); setWs(w); setUsage(u); setYt(y); setTt(t);
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg(done);
      await reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const ytPort = view?.values["youtube_redirect_port"] || view?.defaults["youtube_redirect_port"] || "3456";
  const ttPort = view?.values["tiktok_redirect_port"] || view?.defaults["tiktok_redirect_port"] || "3455";

  return (
    <div className="page">
      <PageHeader title="Настройки" description="Папки, инструменты, ключи API и локальные данные. Секреты хранятся только в backend (Windows Credential Manager)." />
      {!isDesktop() && <Notice>Настройки доступны в desktop-приложении.</Notice>}
      <ErrorNotice error={err} onClose={() => setErr(null)} />
      {msg && <Notice>{msg}</Notice>}

      {view && (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <div className="stack">
            <Section icon={User} title="Профиль">
              <Field label="Ваше имя (для приветствия)"><SettingInput k="user_name" view={view} onSaved={reload} placeholder="Не указано" /></Field>
            </Section>

            <Section icon={FolderOpen} title="Папки">
              <Field label="Проекты (.nexorclip)" hint={`По умолчанию: ${view.defaults["projects_dir"]}`}>
                <PathSetting k="projects_dir" view={view} onSaved={reload} pick={() => pickFolder("Папка проектов")} />
              </Field>
              <Field label="Экспорт видео" hint={`По умолчанию: ${view.defaults["export_dir"]}`}>
                <PathSetting k="export_dir" view={view} onSaved={reload} pick={() => pickFolder("Папка экспорта")} />
              </Field>
            </Section>

            <Section icon={Wrench} title="FFmpeg" subtitle="Монтаж, предпросмотр и экспорт">
              <div className="row">
                <StatusBadge on={!!ff?.found} label={ff?.found ? `ffmpeg ${ff.version ?? ""}` : "ffmpeg не найден"} />
                <StatusBadge on={!!ff?.ffprobeFound} label={ff?.ffprobeFound ? "ffprobe найден" : "ffprobe не найден"} />
                <StatusBadge on={!!ff?.hasLibx264} label="libx264 (H.264)" />
                <StatusBadge on={!!ff?.hasLibass} label="libass (субтитры)" />
              </div>
              {ff?.found && (!ff.hasLibx264 || !ff.hasLibass) && <Notice>Установите полную сборку FFmpeg (gyan.dev «full» или «essentials»), где есть libx264 и libass.</Notice>}
              <Field label="Путь к ffmpeg.exe" hint="Пусто — ffmpeg.exe ищется в PATH">
                <PathSetting k="ffmpeg_path" view={view} onSaved={reload} pick={() => pickExecutable("ffmpeg.exe")} placeholder="ffmpeg.exe из PATH" />
              </Field>
              <Field label="Путь к ffprobe.exe" hint="Пусто — рядом с ffmpeg.exe или из PATH">
                <PathSetting k="ffprobe_path" view={view} onSaved={reload} pick={() => pickExecutable("ffprobe.exe")} placeholder="ffprobe.exe из PATH" />
              </Field>
              <div className="row">
                <Button size="sm" onClick={() => openExternal("https://www.gyan.dev/ffmpeg/builds/")} icon={ExternalLink}>Скачать FFmpeg (gyan.dev)</Button>
                <Button size="sm" onClick={reload}>Проверить</Button>
              </div>
            </Section>

            <Section icon={Captions} title="Субтитры (whisper.cpp)" subtitle="Распознавание речи офлайн">
              <div className="row">
                <StatusBadge on={!!ws?.binaryFound} label={ws?.binaryFound ? "whisper-cli найден" : "whisper-cli не найден"} />
                <StatusBadge on={!!ws?.modelFound} label={ws?.modelFound ? "Модель найдена" : "Модель не выбрана"} />
              </div>
              <Field label="whisper-cli.exe">
                <PathSetting k="whisper_path" view={view} onSaved={reload} pick={() => pickExecutable("whisper-cli.exe")} placeholder="Встроенный или из PATH" />
              </Field>
              <Field label="Модель (ggml-*.bin)" hint="Для русского рекомендуется ggml-small.bin или ggml-medium.bin">
                <PathSetting k="whisper_model_path" view={view} onSaved={reload} pick={pickModelFile} placeholder="Не выбрана" />
              </Field>
              <div className="grid grid-3">
                <Field label="Потоки CPU"><SettingInput k="whisper_threads" view={view} onSaved={reload} type="number" /></Field>
                <Field label="Макс. символов в реплике"><SettingInput k="whisper_max_len" view={view} onSaved={reload} type="number" /></Field>
                <Field label="Язык по умолчанию">
                  <select className="select" value={view.values["subtitle_default_language"] ?? "ru"} onChange={(e) => setSetting("subtitle_default_language", e.target.value).then(reload)}>
                    <option value="ru">Русский</option><option value="en">English</option><option value="auto">Авто</option>
                  </select>
                </Field>
              </div>
              <div className="row">
                <Button size="sm" icon={ExternalLink} onClick={() => openExternal("https://github.com/ggml-org/whisper.cpp/releases")}>whisper.cpp releases</Button>
                <Button size="sm" icon={ExternalLink} onClick={() => openExternal("https://huggingface.co/ggerganov/whisper.cpp/tree/main")}>Модели ggml</Button>
              </div>
            </Section>
          </div>

          <div className="stack">
            <Section icon={MonitorPlay} title="YouTube" subtitle="Google Cloud Console → APIs & Services">
              <SecretInput name="youtube_api_key" view={view} onSaved={reload} label="API-ключ YouTube Data API v3 (поиск, публичные каналы)" />
              <Field label="OAuth Client ID (тип «Desktop app»)">
                <SettingInput k="youtube_client_id" view={view} onSaved={reload} placeholder="xxxxx.apps.googleusercontent.com" />
              </Field>
              <SecretInput name="youtube_client_secret" view={view} onSaved={reload} label="OAuth Client Secret" />
              <Field label="Порт для входа" hint={`Redirect URI: http://127.0.0.1:${ytPort}/callback`}>
                <SettingInput k="youtube_redirect_port" view={view} onSaved={reload} type="number" />
              </Field>
              <div className="row">
                <StatusBadge on={yt} label={yt ? "Канал подключён" : "Канал не подключён"} />
                {yt ? (
                  <Button size="sm" onClick={() => act("yt", ytDisconnect, "YouTube отключён, токен отозван.")}>Отключить</Button>
                ) : (
                  <Button size="sm" variant="primary" disabled={!view.values["youtube_client_id"] || !view.secrets["youtube_client_secret"] || busy === "yt"} onClick={() => act("yt", ytConnect, "Канал YouTube подключён.")}>
                    {busy === "yt" ? "Ожидание входа…" : "Подключить канал"}
                  </Button>
                )}
              </div>
            </Section>

            <Section icon={Music} title="TikTok" subtitle="developers.tiktok.com → ваше приложение">
              <Field label="Client Key"><SettingInput k="tiktok_client_key" view={view} onSaved={reload} placeholder="Не задан" /></Field>
              <SecretInput name="tiktok_client_secret" view={view} onSaved={reload} label="Client Secret" />
              <Field label="Порт для входа" hint={`Redirect URI: http://127.0.0.1:${ttPort}/callback/`}>
                <SettingInput k="tiktok_redirect_port" view={view} onSaved={reload} type="number" />
              </Field>
              <Toggle
                checked={view.values["tiktok_publish_enabled"] === "1"}
                onChange={(v) => setSetting("tiktok_publish_enabled", v ? "1" : "0").then(reload)}
                label="Разрешить публикацию (Content Posting API, scope video.publish)"
              />
              <div className="small muted">После изменения разрешения переподключите аккаунт. Публикация выполняется только по вашей команде из окна экспорта.</div>
              <div className="row">
                <StatusBadge on={tt} label={tt ? "Аккаунт подключён" : "Аккаунт не подключён"} />
                {tt ? (
                  <Button size="sm" onClick={() => act("tt", ttDisconnect, "TikTok отключён.")}>Отключить</Button>
                ) : (
                  <Button size="sm" variant="primary" disabled={!view.values["tiktok_client_key"] || !view.secrets["tiktok_client_secret"] || busy === "tt"} onClick={() => act("tt", ttConnect, "TikTok подключён.")}>
                    {busy === "tt" ? "Ожидание входа…" : "Подключить TikTok"}
                  </Button>
                )}
              </div>
            </Section>

            <Section icon={Database} title="Локальные данные">
              {usage && (
                <table className="table">
                  <tbody>
                    <tr><td>Папка данных</td><td className="small mono truncate" style={{ maxWidth: 260 }} title={usage.dataDir}>{usage.dataDir}</td></tr>
                    <tr><td>База данных</td><td>{formatBytes(usage.databaseBytes)}</td></tr>
                    <tr><td>Кэш (превью, временные файлы)</td><td>{formatBytes(usage.cacheBytes)}</td></tr>
                    <tr><td>Проектов / рекламных материалов</td><td>{usage.projects} / {usage.adAssets}</td></tr>
                    <tr><td>Снимков аналитики</td><td>{usage.snapshots}</td></tr>
                  </tbody>
                </table>
              )}
              <div className="row">
                {usage && <Button size="sm" icon={HardDrive} onClick={() => revealPath(usage.dataDir)}>Открыть папку</Button>}
                <Button size="sm" icon={Trash2} disabled={busy === "cache"} onClick={() => act("cache", clearCache, "Кэш очищен.")}>Очистить кэш</Button>
                <Button size="sm" icon={Trash2} onClick={() => confirm("Удалить локальную историю аналитики? Графики начнут копиться заново.") && act("hist", clearAnalyticsHistory, "История аналитики удалена.")}>Очистить историю аналитики</Button>
                <Button size="sm" onClick={() => confirm("Сбросить счётчики на главной?") && act("cnt", resetCounters, "Счётчики сброшены.")}>Сбросить счётчики</Button>
              </div>
              <div className="small muted">Ничего не отправляется в облако. Исходные файлы пользователя никогда не удаляются.</div>
            </Section>

            <Section icon={KeyRound} title="Безопасность">
              <div className="small muted">
                API-ключи, client secrets и токены хранятся в Windows Credential Manager и используются только backend-частью на Rust.
                Интерфейс видит лишь отметку «сохранено». Вход выполняется через официальный OAuth в системном браузере (PKCE).
              </div>
            </Section>

            <Section icon={Info} title="О программе">
              <table className="table">
                <tbody>
                  <tr><td>Версия</td><td>NEXOR CLIP {appInfo?.version ?? APP_VERSION}</td></tr>
                  <tr><td>Система</td><td>{appInfo?.os ?? "—"}</td></tr>
                  <tr><td>Режим</td><td>{appInfo?.runtime === "desktop" ? "Desktop (Tauri 2)" : "Браузерный предпросмотр"}</td></tr>
                </tbody>
              </table>
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
