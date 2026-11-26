import { useState, type ReactNode } from "react";
import { FolderOpen, Plus } from "lucide-react";
import type { AspectRatio, RouteId } from "@/types";
import { Button, EmptyState, ErrorNotice, Field, Modal, Segmented } from "@/components/ui";
import { errorText, isDesktop } from "@/services/tauri";
import { useProject } from "./ProjectContext";

export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const { create } = useProject();
  const [name, setName] = useState("");
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await create(name.trim() || "Новый проект", aspect);
      onCreated?.();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Новый проект"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>Создать</Button>
        </>
      }
    >
      <Field label="Название">
        <input className="input" autoFocus value={name} placeholder="Новый проект" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
      <Field label="Формат кадра" hint="Можно изменить позже в редакторе">
        <Segmented<AspectRatio>
          value={aspect}
          onChange={setAspect}
          options={[
            { value: "9:16", label: "9:16 вертикальный" },
            { value: "16:9", label: "16:9 горизонтальный" },
            { value: "1:1", label: "1:1 квадрат" },
          ]}
        />
      </Field>
      <ErrorNotice error={err} />
    </Modal>
  );
}

/** Показывает содержимое только при открытом проекте; иначе — выбор/создание. */
export function ProjectGate({ children, navigate, text }: { children: ReactNode; navigate: (r: RouteId) => void; text: string }) {
  const { project, loading } = useProject();
  const [creating, setCreating] = useState(false);
  if (project) return <>{children}</>;
  if (loading) return <div className="muted small">Открытие проекта…</div>;
  return (
    <div className="card">
      <EmptyState
        icon={FolderOpen}
        title="Проект не открыт"
        text={isDesktop() ? text : "Работа с проектами доступна в desktop-приложении (npm run app:dev)."}
        action={
          isDesktop() ? (
            <div className="row" style={{ justifyContent: "center" }}>
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Создать проект</Button>
              <Button icon={FolderOpen} onClick={() => navigate("projects")}>Мои проекты</Button>
            </div>
          ) : undefined
        }
      />
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

export function SaveIndicator() {
  const { saveState, saveError } = useProject();
  const label = { saved: "Сохранено", dirty: "Изменения…", saving: "Сохранение…", error: "Ошибка сохранения" }[saveState];
  return (
    <span className="badge" title={saveError ?? undefined}>
      <span className={`dot ${saveState === "saved" ? "dot--on" : ""}`} />
      {label}
    </span>
  );
}
