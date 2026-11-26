import { useState } from "react";
import { Copy, FileUp, FolderOpen, FolderSearch, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { PageProps } from "@/app/App";
import type { ProjectSummary } from "@/types";
import { Button, Card, EmptyState, ErrorNotice, Field, Modal, Notice, PageHeader } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { deleteProject, duplicateProject, importProjectFile, listProjects, projectFilePath, renameProject } from "@/features/projects/projectsService";
import { useProject } from "@/features/projects/ProjectContext";
import { NewProjectDialog } from "@/features/projects/ProjectGate";
import { revealPath } from "@/services/system";
import { errorText, isDesktop } from "@/services/tauri";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("ru-RU") : "—");

export function ProjectsPage({ navigate }: PageProps) {
  const projects = useAsync(listProjects);
  const ctx = useProject();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      projects.reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const open = (id: string) =>
    act(async () => {
      await ctx.open(id);
      navigate("editor");
    });

  const doRename = () =>
    renaming &&
    newName.trim() &&
    act(async () => {
      if (ctx.project?.id === renaming.id) await ctx.rename(newName.trim());
      else await renameProject(renaming.id, newName.trim());
      setRenaming(null);
    });

  const doDelete = () =>
    deleting &&
    act(async () => {
      if (ctx.project?.id === deleting.id) ctx.close();
      await deleteProject(deleting.id);
      setDeleting(null);
    });

  const list = (projects.data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <PageHeader
        title="Мои проекты"
        description="Проекты хранятся локально в SQLite. Удаление проекта никогда не удаляет исходные видео, аудио и изображения."
        actions={
          <>
            <Button icon={RefreshCw} onClick={projects.reload}>Обновить</Button>
            <Button icon={FileUp} disabled={!isDesktop()} onClick={() => act(async () => { const p = await importProjectFile(); if (p) { await ctx.open(p.id); } })}>
              Импорт .nexorclip
            </Button>
            <Button variant="primary" icon={Plus} disabled={!isDesktop()} onClick={() => setCreating(true)}>Создать проект</Button>
          </>
        }
      />
      {!isDesktop() && <Notice>Список проектов доступен в desktop-приложении.</Notice>}
      <ErrorNotice error={err || projects.error} onClose={() => setErr(null)} />

      <Card
        title="Проекты"
        subtitle={`${projects.data?.length ?? 0} всего`}
        actions={<input className="input" style={{ width: 240 }} placeholder="Поиск по названию…" value={q} onChange={(e) => setQ(e.target.value)} />}
        flush
      >
        {list.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={FolderOpen} title={q ? "Ничего не найдено" : "Проектов пока нет"} text={q ? undefined : "Создайте проект, чтобы начать монтаж."} />
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Название</th><th>Формат</th><th>Создан</th><th>Изменён</th><th>Последний экспорт</th><th /></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="link" onClick={() => open(p.id)}>{p.name}</button>{" "}
                    {ctx.project?.id === p.id && <span className="badge">Открыт</span>}
                  </td>
                  <td className="mono">{p.aspectRatio}</td>
                  <td>{fmt(p.createdAt)}</td>
                  <td>{fmt(p.updatedAt)}</td>
                  <td>{fmt(p.lastExport)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="primary" onClick={() => open(p.id)}>Открыть</Button>{" "}
                    <Button size="sm" iconOnly icon={Pencil} title="Переименовать" onClick={() => { setRenaming(p); setNewName(p.name); }} />
                    <Button size="sm" iconOnly icon={Copy} title="Дублировать" onClick={() => act(() => duplicateProject(p.id))} />
                    <Button size="sm" iconOnly icon={FolderSearch} title="Показать файл проекта" onClick={() => act(async () => revealPath(await projectFilePath(p.id)))} />
                    <Button size="sm" iconOnly icon={Trash2} title="Удалить" onClick={() => setDeleting(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={() => navigate("editor")} />}
      {renaming && (
        <Modal
          title="Переименовать проект"
          onClose={() => setRenaming(null)}
          width={420}
          footer={<><Button onClick={() => setRenaming(null)}>Отмена</Button><Button variant="primary" onClick={doRename}>Сохранить</Button></>}
        >
          <Field label="Название">
            <input className="input" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doRename()} />
          </Field>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить проект?"
          onClose={() => setDeleting(null)}
          width={460}
          footer={<><Button onClick={() => setDeleting(null)}>Отмена</Button><Button variant="primary" icon={Trash2} onClick={doDelete}>Удалить проект</Button></>}
        >
          <div>Проект «{deleting.name}» будет удалён из базы приложения.</div>
          <Notice>Исходные видео, аудио, изображения и экспортированные ролики останутся на диске нетронутыми.</Notice>
        </Modal>
      )}
    </div>
  );
}
