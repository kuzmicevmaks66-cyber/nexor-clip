import { useCallback, useEffect, useState } from "react";
import { CircleCheck, LogIn, LogOut, MonitorPlay, Music, type LucideIcon } from "lucide-react";
import { Button, ErrorNotice, Modal, Notice } from "@/components/ui";
import { getSettings, setSecret, setSetting } from "@/services/system";
import { ytConnect, ytDisconnect, ytIsConnected, ytMyChannel } from "@/services/youtube";
import { ttConnect, ttDisconnect, ttIsConnected, ttUser } from "@/services/tiktok";
import { errorText, isDesktop } from "@/services/tauri";
import { formatNumber } from "@/services/format";
import type { SettingsView } from "@/types";

export const STARTUP_KEY = "nexor.accountsOnStartup";

/** Показывать ли окно аккаунтов при запуске (по умолчанию — да). */
export const showOnStartup = () => localStorage.getItem(STARTUP_KEY) !== "0";

interface Account {
  name: string;
  avatar: string | null;
  sub: string;
}

type Platform = "yt" | "tt";

interface PlatformDef {
  id: Platform;
  title: string;
  icon: LucideIcon;
  idKey: string;
  idLabel: string;
  secretKey: string;
  secretLabel: string;
  portKey: string;
  defaultPort: string;
  redirectPath: string;
  consoleHint: string;
  isConnected: () => Promise<boolean>;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<void>;
  profile: () => Promise<Account>;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: "yt",
    title: "YouTube",
    icon: MonitorPlay,
    idKey: "youtube_client_id",
    idLabel: "OAuth Client ID",
    secretKey: "youtube_client_secret",
    secretLabel: "OAuth Client Secret",
    portKey: "youtube_redirect_port",
    defaultPort: "3456",
    redirectPath: "/callback",
    consoleHint: "Google Cloud Console → OAuth client типа «Desktop app».",
    isConnected: ytIsConnected,
    connect: ytConnect,
    disconnect: ytDisconnect,
    profile: async () => {
      const c = await ytMyChannel();
      return {
        name: c.title,
        avatar: c.thumbnail,
        sub: c.subscribers != null ? `${formatNumber(c.subscribers)} подписчиков` : "Подписчики скрыты",
      };
    },
  },
  {
    id: "tt",
    title: "TikTok",
    icon: Music,
    idKey: "tiktok_client_key",
    idLabel: "Client Key",
    secretKey: "tiktok_client_secret",
    secretLabel: "Client Secret",
    portKey: "tiktok_redirect_port",
    defaultPort: "3455",
    redirectPath: "/callback/",
    consoleHint: "TikTok for Developers → приложение с Login Kit.",
    isConnected: ttIsConnected,
    connect: ttConnect,
    disconnect: ttDisconnect,
    profile: async () => {
      const u = await ttUser();
      return {
        name: u.displayName || u.username || "Аккаунт TikTok",
        avatar: u.avatarUrl,
        sub: u.followers != null ? `${formatNumber(u.followers)} подписчиков` : "Подписчики: недоступно через API",
      };
    },
  },
];

function PlatformCard({ def, view, onChanged, onOpenPage }: {
  def: PlatformDef;
  view: SettingsView;
  onChanged: () => Promise<void>;
  onOpenPage: () => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [idValue, setIdValue] = useState(view.values[def.idKey] ?? "");
  const [secretValue, setSecretValue] = useState("");

  const configured = !!view.values[def.idKey] && !!view.secrets[def.secretKey];
  const port = view.values[def.portKey] || view.defaults[def.portKey] || def.defaultPort;
  const Icon = def.icon;

  const refresh = useCallback(async () => {
    try {
      const ok = await def.isConnected();
      setConnected(ok);
      setAccount(ok ? await def.profile().catch(() => null) : null);
    } catch {
      setConnected(false);
    }
  }, [def]);
  useEffect(() => void refresh(), [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
      await refresh();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAndLogin = () =>
    run(async () => {
      if (!idValue.trim()) throw new Error(`Укажите ${def.idLabel}.`);
      if (!secretValue.trim() && !view.secrets[def.secretKey]) throw new Error(`Укажите ${def.secretLabel}.`);
      await setSetting(def.idKey, idValue.trim());
      if (secretValue.trim()) await setSecret(def.secretKey, secretValue.trim());
      setSecretValue("");
      await def.connect();
    });

  return (
    <div className="account-card">
      <div className="account-card__head">
        <div className="account-card__logo"><Icon size={22} strokeWidth={1.8} /></div>
        <div className="account-card__title">{def.title}</div>
        {connected && <span className="badge badge--solid"><CircleCheck size={12} /> Подключён</span>}
      </div>

      {connected === null && <div className="muted">Проверка…</div>}

      {connected && (
        <>
          <div className="account-card__user">
            <div className="avatar">{account?.avatar ? <img src={account.avatar} alt="" /> : <Icon size={20} />}</div>
            <div>
              <div className="account-card__name">{account?.name ?? "Аккаунт подключён"}</div>
              {account && <div className="muted">{account.sub}</div>}
            </div>
          </div>
          <div className="account-card__actions">
            <Button variant="primary" onClick={onOpenPage}>Открыть {def.title}</Button>
            <Button icon={LogOut} disabled={busy} onClick={() => run(def.disconnect)}>Выйти</Button>
          </div>
        </>
      )}

      {connected === false && configured && (
        <>
          <p className="muted account-card__text">Войдите в аккаунт: откроется официальная страница входа {def.title} в браузере.</p>
          <div className="account-card__actions">
            <Button variant="primary" icon={LogIn} disabled={busy} onClick={() => run(def.connect)}>
              {busy ? "Ожидание входа в браузере…" : `Войти в ${def.title}`}
            </Button>
          </div>
        </>
      )}

      {connected === false && !configured && (
        <>
          <p className="muted account-card__text">Для входа нужны ключи приложения: {def.consoleHint}</p>
          <label className="account-card__field">
            <span>{def.idLabel}</span>
            <input className="input input--mono" value={idValue} onChange={(e) => setIdValue(e.target.value)} spellCheck={false} />
          </label>
          <label className="account-card__field">
            <span>{def.secretLabel}{view.secrets[def.secretKey] ? " (сохранён)" : ""}</span>
            <input className="input input--mono" type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} autoComplete="off" />
          </label>
          <div className="muted account-card__hint">Redirect URI: <code>http://127.0.0.1:{port}{def.redirectPath}</code></div>
          <div className="account-card__actions">
            <Button variant="primary" icon={LogIn} disabled={busy} onClick={saveAndLogin}>
              {busy ? "Ожидание входа в браузере…" : `Сохранить и войти`}
            </Button>
          </div>
        </>
      )}

      <ErrorNotice error={err} onClose={() => setErr(null)} />
    </div>
  );
}

/** Окно входа в YouTube и TikTok, показывается при запуске приложения. */
export function AccountsWindow({ onClose, navigate }: {
  onClose: () => void;
  navigate: (id: "youtube" | "tiktok") => void;
}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [startup, setStartup] = useState(showOnStartup);

  const load = useCallback(async () => {
    try {
      setView(await getSettings());
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (isDesktop()) void load();
  }, [load]);

  const toggleStartup = (v: boolean) => {
    setStartup(v);
    localStorage.setItem(STARTUP_KEY, v ? "1" : "0");
  };

  return (
    <Modal
      title="Аккаунты YouTube и TikTok"
      onClose={onClose}
      width={820}
      footer={
        <>
          <label className="account-startup">
            <input type="checkbox" checked={startup} onChange={(e) => toggleStartup(e.target.checked)} />
            Показывать при запуске
          </label>
          <Button variant="primary" onClick={onClose}>Продолжить</Button>
        </>
      }
    >
      {!isDesktop() && <Notice>Вход доступен в desktop-приложении.</Notice>}
      <ErrorNotice error={err} onClose={() => setErr(null)} />
      {view && (
        <div className="account-grid">
          {PLATFORMS.map((p) => (
            <PlatformCard
              key={p.id}
              def={p}
              view={view}
              onChanged={load}
              onOpenPage={() => {
                onClose();
                navigate(p.id === "yt" ? "youtube" : "tiktok");
              }}
            />
          ))}
        </div>
      )}
      <div className="muted account-card__hint">
        Вход выполняется только через официальный OAuth в браузере. Пароли приложение не видит, токены хранятся в Windows Credential Manager.
      </div>
    </Modal>
  );
}
