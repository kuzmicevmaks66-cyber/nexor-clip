import { useEffect, useState } from "react";
import { ArrowRight, Captions, ChartColumn, Clapperboard, FolderOpen, Megaphone, MonitorPlay, Plus } from "lucide-react";
import type { PageProps } from "@/app/App";
import { Button, Card, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { getDashboardStats, getSettings } from "@/services/system";
import { listProjects } from "@/features/projects/projectsService";
import { useProject } from "@/features/projects/ProjectContext";
import { NewProjectDialog } from "@/features/projects/ProjectGate";
import { errorText, isDesktop } from "@/services/tauri";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function HomePage({ navigate }: PageProps) {
  const { project, open } = useProject();
  const stats = useAsync(getDashboardStats);
  const recent = useAsync(listProjects);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = stats.data ?? { projectsCount: 0, clipsExported: 0, videosProcessed: 0 };

  useEffect(() => {
    if (isDesktop()) getSettings().then((v) => setName(v.values["user_name"] ?? "")).catch(() => undefined);
  }, []);

  const openProject = async (id: string) => {
    try {
      await open(id);
      navigate("editor");
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={name.trim() ? `${greeting()}, ${name.trim()}` : greeting()}
        description="NEXOR CLIP — монтаж, субтитры и аналитика коротких видео. Всё хранится локально на этом компьютере."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={!isDesktop()}>
            Создать проект
          </Button>
        }
      />
      {!isDesktop() && <Notice>Открыт браузерный предпросмотр интерфейса. Запустите приложение через «npm run app:dev» или установщик.</Notice>}
      {err && <Notice>{err}</Notice>}

      <div className="grid grid-3">
        <Stat label="Проекты" value={s.projectsCount} hint="В локальной базе" />
        <Stat label="Созданные ролики" value={s.clipsExported} hint="Экспортировано в MP4" />
        <Stat label="Обработанные видео" value={s.videosProcessed} hint="Исходники в экспортах" />
      </div>

      <div className="grid grid-sidebar">
        <Card
          title="Последние проекты"
          actions={<Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => navigate("projects")}>Все проекты</Button>}
        >
          {recent.data && recent.data.length > 0 ? (
            <div className="list">
              {recent.data.slice(0, 6).map((p) => (
                <button type="button" className="list-item list-item--button" key={p.id} onClick={() => openProject(p.id)}>
                  <FolderOpen size={18} />
                  <div className="list-item__main">
                    <div className="list-item__title">
                      {p.name} {project?.id === p.id && <span className="badge">Открыт</span>}
                    </div>
                    <div className="list-item__meta">
                      Изменён {new Date(p.updatedAt).toLocaleString("ru-RU")} · {p.aspectRatio}
                    </div>
                  </div>
                  <ArrowRight size={16} className="muted" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={FolderOpen} title="Проектов пока нет" text="Создайте первый проект — он появится здесь." />
          )}
        </Card>

        <Card title="Быстрый переход">
          <div className="stack">
            <QuickLink icon={Clapperboard} title="Видеоредактор" text="Импорт, обрезка, 9:16 / 16:9 / 1:1" onClick={() => navigate("editor")} />
            <QuickLink icon={Captions} title="Субтитры" text="Whisper RU/EN, стили, анимации" onClick={() => navigate("subtitles")} />
            <QuickLink icon={MonitorPlay} title="YouTube" text="Поиск и выбор фрагментов" onClick={() => navigate("youtube")} />
            <QuickLink icon={ChartColumn} title="Аналитика" text="YouTube и TikTok" onClick={() => navigate("analytics")} />
            <QuickLink icon={Megaphone} title="Реклама" text="Локальная библиотека вставок" onClick={() => navigate("ads")} />
          </div>
        </Card>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={() => navigate("editor")} />}
    </div>
  );
}

function QuickLink({ icon: Icon, title, text, onClick }: { icon: typeof Clapperboard; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="list-item list-item--button quick-link">
      <Icon size={20} />
      <div className="list-item__main">
        <div className="list-item__title">{title}</div>
        <div className="list-item__meta">{text}</div>
      </div>
      <ArrowRight size={16} className="muted" />
    </button>
  );
}
