import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { NAV_ITEMS, SECTION_LABELS, routeLabel } from "@/app/routes";
import type { AppInfo, RouteId } from "@/types";
import { StatusBadge } from "@/components/ui";
import { useProject } from "@/features/projects/ProjectContext";
import { SaveIndicator } from "@/features/projects/ProjectGate";

interface Props {
  route: RouteId;
  appInfo: AppInfo | null;
  children: ReactNode;
  onOpenAccounts: () => void;
}

const COLLAPSE_KEY = "nexor.sidebarCollapsed";

export function AppLayout({ route, appInfo, children, onOpenAccounts }: Props) {
  const { project } = useProject();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  // На узких окнах автоматически сворачиваем панель.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px)");
    const apply = () => mq.matches && setCollapsed(true);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  let lastSection: string | null = null;

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="brand-mark">N</div>
          <div className="brand-text">
            NEXOR <span>CLIP</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => {
            const label = SECTION_LABELS[item.section];
            const showSection = label && label !== lastSection;
            if (label) lastSection = label;
            const Icon = item.icon;
            return (
              <div key={item.id} style={{ display: "contents" }}>
                {showSection && <div className="nav-section">{label}</div>}
                <a
                  href={`#/${item.id}`}
                  className={`nav-link ${route === item.id ? "active" : ""}`}
                  title={collapsed ? item.label : undefined}
                  aria-current={route === item.id ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </a>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <span className="sidebar__version">
            v{appInfo?.version ?? "—"} · {appInfo?.runtime === "desktop" ? "Desktop" : "UI preview"}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={toggle}
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{routeLabel(route)}</div>
          <div className="topbar__meta">
            {project && (
              <a href="#/editor" className="badge" title="Открытый проект">
                {project.name}
              </a>
            )}
            {project && <SaveIndicator />}
            <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenAccounts} title="Вход в YouTube и TikTok">
              <UserRound size={14} /> Аккаунты
            </button>
            <StatusBadge
              on={appInfo?.runtime === "desktop"}
              label={appInfo?.runtime === "desktop" ? "Локальный режим" : "Браузерный предпросмотр UI"}
            />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
