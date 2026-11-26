import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AspectRatio } from "@/types";
import type { Project, ProjectData } from "@/types/project";
import { allowMediaPaths } from "@/services/system";
import { errorText, isDesktop } from "@/services/tauri";
import { createProject, getProject, renameProject, saveProject } from "./projectsService";

const CURRENT_KEY = "nexor.currentProject";
const HISTORY_LIMIT = 80;

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Ctx {
  project: Project | null;
  loading: boolean;
  saveState: SaveState;
  saveError: string | null;
  missingFiles: string[];
  open: (id: string) => Promise<void>;
  create: (name: string, aspect: AspectRatio) => Promise<Project>;
  close: () => void;
  /** Изменение данных проекта. `coalesce` — объединять частые правки (ползунки) в один шаг отмены. */
  update: (fn: (d: ProjectData) => ProjectData, coalesce?: string) => void;
  rename: (name: string) => Promise<void>;
  saveNow: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Гарантирует открытый проект (создаёт новый при необходимости). */
  ensure: (nameHint?: string) => Promise<Project>;
}

const ProjectCtx = createContext<Ctx | null>(null);

function collectPaths(d: ProjectData): string[] {
  const s = new Set<string>();
  d.media.forEach((m) => s.add(m.path));
  d.clips.forEach((c) => s.add(c.path));
  d.audio.forEach((a) => s.add(a.path));
  d.overlays.forEach((o) => s.add(o.path));
  return [...s];
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [missingFiles, setMissing] = useState<string[]>([]);
  const past = useRef<ProjectData[]>([]);
  const future = useRef<ProjectData[]>([]);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const [, force] = useState(0);
  const timer = useRef<number | null>(null);
  const latest = useRef<Project | null>(null);
  latest.current = project;

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = latest.current;
    if (!p) return;
    setSaveState("saving");
    try {
      const updatedAt = await saveProject(p.id, p.data);
      setProject((cur) => (cur && cur.id === p.id ? { ...cur, updatedAt } : cur));
      setSaveState("saved");
      setSaveError(null);
    } catch (e) {
      setSaveState("error");
      setSaveError(errorText(e));
    }
  }, []);

  const schedule = useCallback(() => {
    setSaveState("dirty");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  }, [flush]);

  // Сохранение при закрытии окна.
  useEffect(() => {
    const h = () => {
      if (timer.current) void flush();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flush]);

  const load = useCallback(async (p: Project) => {
    past.current = [];
    future.current = [];
    latest.current = p;
    setProject(p);
    setSaveState("saved");
    localStorage.setItem(CURRENT_KEY, p.id);
    const paths = collectPaths(p.data);
    setMissing(paths.length ? await allowMediaPaths(paths).catch(() => []) : []);
  }, []);

  const open = useCallback(
    async (id: string) => {
      if (timer.current) await flush();
      setLoading(true);
      try {
        await load(await getProject(id));
      } finally {
        setLoading(false);
      }
    },
    [flush, load],
  );

  useEffect(() => {
    const id = localStorage.getItem(CURRENT_KEY);
    if (id && isDesktop()) {
      open(id).catch(() => localStorage.removeItem(CURRENT_KEY));
    }
  }, [open]);

  const create = useCallback(
    async (name: string, aspect: AspectRatio) => {
      if (timer.current) await flush();
      const p = await createProject(name, aspect);
      await load(p);
      return p;
    },
    [flush, load],
  );

  const close = useCallback(() => {
    if (timer.current) void flush();
    localStorage.removeItem(CURRENT_KEY);
    latest.current = null;
    setProject(null);
    setMissing([]);
  }, [flush]);

  const update = useCallback(
    (fn: (d: ProjectData) => ProjectData, coalesce?: string) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fn(cur.data);
      if (next === cur.data) return;
      const now = Date.now();
      const merge = coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < 1200;
      if (!merge) {
        past.current.push(cur.data);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
      future.current = [];
      const np = { ...cur, aspectRatio: next.aspectRatio, data: next };
      latest.current = np;
      setProject(np);
      schedule();
    },
    [schedule],
  );

  const undo = useCallback(() => {
    const cur = latest.current;
    const prev = past.current.pop();
    if (!cur || !prev) return;
    future.current.push(cur.data);
    lastCoalesce.current = null;
    const np = { ...cur, aspectRatio: prev.aspectRatio, data: prev };
    latest.current = np;
    setProject(np);
    schedule();
    force((x) => x + 1);
  }, [schedule]);

  const redo = useCallback(() => {
    const cur = latest.current;
    const nxt = future.current.pop();
    if (!cur || !nxt) return;
    past.current.push(cur.data);
    lastCoalesce.current = null;
    const np = { ...cur, aspectRatio: nxt.aspectRatio, data: nxt };
    latest.current = np;
    setProject(np);
    schedule();
    force((x) => x + 1);
  }, [schedule]);

  const rename = useCallback(async (name: string) => {
    const cur = latest.current;
    if (!cur) return;
    await renameProject(cur.id, name);
    latest.current = { ...cur, name: name.trim() };
    setProject((p) => (p ? { ...p, name: name.trim() } : p));
  }, []);

  const ensure = useCallback(
    async (nameHint?: string) => {
      if (latest.current) return latest.current;
      const d = new Date();
      const name = nameHint || `Проект ${d.toLocaleDateString("ru-RU")} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
      return create(name, "9:16");
    },
    [create],
  );

  const value = useMemo<Ctx>(
    () => ({
      project,
      loading,
      saveState,
      saveError,
      missingFiles,
      open,
      create,
      close,
      update,
      rename,
      saveNow: flush,
      undo,
      redo,
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      ensure,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, loading, saveState, saveError, missingFiles, open, create, close, update, rename, flush, undo, redo, ensure],
  );

  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject(): Ctx {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("useProject вне ProjectProvider");
  return c;
}
