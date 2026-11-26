import { useEffect, useState } from "react";
import { Download, FolderOpen, Send, X } from "lucide-react";
import { Button, ErrorNotice, Field, Modal, ProgressBar, Toggle } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useProject } from "@/features/projects/ProjectContext";
import { defaultExportDir, exportVideo } from "@/services/media";
import { pickFolder, revealPath } from "@/services/system";
import { formatBytes, formatTime } from "@/services/format";
import type { RenderResult } from "@/types";
import { buildSpec, FPS_OPTIONS, frameSize, QUALITY, RESOLUTIONS, timelineDuration } from "./spec";
import { PublishDialog } from "@/features/publish/PublishDialog";

const PRESETS = [
  { value: "veryfast", label: "Быстро" },
  { value: "medium", label: "Сбалансированно" },
  { value: "slow", label: "Лучшее сжатие" },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, update } = useProject();
  const job = useJob();
  const [defaultDir, setDefaultDir] = useState("");
  const [result, setResult] = useState<RenderResult | null>(null);
  const [publish, setPublish] = useState(false);

  useEffect(() => {
    defaultExportDir().then(setDefaultDir).catch(() => {});
  }, []);

  if (!project) return null;
  const d = project.data;
  const ex = d.export;
  const set = (patch: Partial<typeof ex>) => update((p) => ({ ...p, export: { ...p.export, ...patch } }), "export-settings");
  const { width, height } = frameSize(d.aspectRatio, ex.resolution);
  const duration = timelineDuration(d.clips);
  const hasSubs = d.subtitles.cues.length > 0;

  const start = async () => {
    setResult(null);
    const r = await job.run(
      (jobId) =>
        exportVideo({
          jobId,
          spec: buildSpec(d),
          outputDir: ex.folder,
          fileName: ex.fileName || project.name,
          crf: ex.crf,
          preset: ex.preset,
          audioBitrate: ex.audioBitrate,
          projectId: project.id,
        }),
      "Подготовка…",
    );
    if (r) setResult(r);
  };

  if (publish && result) {
    return <PublishDialog path={result.path} defaultTitle={project.name} onClose={onClose} />;
  }

  return (
    <Modal
      title="Экспорт видео"
      onClose={job.running ? () => {} : onClose}
      width={600}
      footer={
        job.running ? (
          <Button icon={X} onClick={job.cancel}>
            Отменить
          </Button>
        ) : result ? (
          <>
            <Button icon={FolderOpen} onClick={() => revealPath(result.path)}>
              Показать в папке
            </Button>
            <Button icon={Send} onClick={() => setPublish(true)}>
              Опубликовать…
            </Button>
            <Button variant="primary" onClick={onClose}>
              Готово
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Закрыть</Button>
            <Button variant="primary" icon={Download} onClick={start} disabled={d.clips.length === 0}>
              Экспортировать MP4
            </Button>
          </>
        )
      }
    >
      <div className="grid grid-2">
        <Field label="Разрешение" hint={`${width}×${height} · ${d.aspectRatio}`}>
          <select className="select" value={ex.resolution} disabled={job.running} onChange={(e) => set({ resolution: +e.target.value })}>
            {RESOLUTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Частота кадров">
          <select className="select" value={ex.fps} disabled={job.running} onChange={(e) => set({ fps: +e.target.value })}>
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>
        </Field>
        <Field label="Качество" hint={`H.264, CRF ${ex.crf}`}>
          <select className="select" value={ex.crf} disabled={job.running} onChange={(e) => set({ crf: +e.target.value })}>
            {QUALITY.map((q) => (
              <option key={q.crf} value={q.crf}>{q.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Скорость кодирования">
          <select className="select" value={ex.preset} disabled={job.running} onChange={(e) => set({ preset: e.target.value })}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Звук (AAC)">
          <select className="select" value={ex.audioBitrate} disabled={job.running} onChange={(e) => set({ audioBitrate: e.target.value })}>
            {["128k", "192k", "256k", "320k"].map((b) => (
              <option key={b} value={b}>{b.replace("k", " кбит/с")}</option>
            ))}
          </select>
        </Field>
        <Field label="Имя файла" hint=".mp4 добавится автоматически; существующие файлы не перезаписываются">
          <input className="input" value={ex.fileName} disabled={job.running} onChange={(e) => set({ fileName: e.target.value })} />
        </Field>
      </div>
      <Field label="Папка">
        <div className="input-group">
          <input className="input" readOnly value={ex.folder ?? defaultDir} />
          <Button
            disabled={job.running}
            onClick={async () => {
              const f = await pickFolder("Папка для экспорта");
              if (f) set({ folder: f });
            }}
          >
            Выбрать…
          </Button>
          {ex.folder && (
            <Button disabled={job.running} onClick={() => set({ folder: null })} title="Папка по умолчанию из настроек">
              По умолчанию
            </Button>
          )}
        </div>
      </Field>
      <Toggle
        checked={d.subtitles.enabled && hasSubs}
        disabled={!hasSubs || job.running}
        onChange={(v) => update((p) => ({ ...p, subtitles: { ...p.subtitles, enabled: v } }))}
        label={hasSubs ? `Вшить субтитры (${d.subtitles.cues.length} реплик)` : "Субтитров нет — создайте их в разделе «Субтитры»"}
      />
      <div className="small muted">
        Длительность: {formatTime(duration)} · фрагментов: {d.clips.length} · аудио: {d.audio.length} · наложений: {d.overlays.length}
      </div>

      {(job.running || job.progress > 0) && !result && <ProgressBar value={job.progress} label={job.message} />}
      <ErrorNotice error={job.error} onClose={job.clearError} />
      {result && (
        <div className="notice">
          <Download size={16} />
          <div>
            <strong>Готово.</strong> {result.path}
            <div className="small muted">
              {formatTime(result.duration)} · {formatBytes(result.size)}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
