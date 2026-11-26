import type { LucideIcon } from "lucide-react";
import {
  ChartColumn,
  Clapperboard,
  Captions,
  FolderOpen,
  House,
  Megaphone,
  MonitorPlay,
  Music,
  Settings,
} from "lucide-react";
import type { RouteId } from "@/types";

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  section: "main" | "sources" | "studio" | "library" | "system";
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Главная", icon: House, section: "main" },
  { id: "youtube", label: "YouTube", icon: MonitorPlay, section: "sources" },
  { id: "tiktok", label: "TikTok", icon: Music, section: "sources" },
  { id: "analytics", label: "Аналитика", icon: ChartColumn, section: "sources" },
  { id: "editor", label: "Видеоредактор", icon: Clapperboard, section: "studio" },
  { id: "subtitles", label: "Субтитры", icon: Captions, section: "studio" },
  { id: "ads", label: "Реклама", icon: Megaphone, section: "studio" },
  { id: "projects", label: "Мои проекты", icon: FolderOpen, section: "library" },
  { id: "settings", label: "Настройки", icon: Settings, section: "system" },
];

export const SECTION_LABELS: Record<NavItem["section"], string | null> = {
  main: null,
  sources: "Источники",
  studio: "Студия",
  library: "Библиотека",
  system: "Система",
};

export const ROUTE_IDS = NAV_ITEMS.map((i) => i.id);

export function routeLabel(id: RouteId): string {
  return NAV_ITEMS.find((i) => i.id === id)?.label ?? "";
}
