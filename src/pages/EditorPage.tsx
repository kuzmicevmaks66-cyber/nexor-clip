import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, AudioLines, Download, Film, ImagePlus, Music, Plus, Redo2, Scissors, Trash2, Undo2, Eye, X,
} from "lucide-react";
import type { PageProps } from "@/app/App";
import type { AspectRatio, MediaInfo } from "@/types";
import type { Fit, ProjectData } from "@/types/project";
import { Button, Card, ErrorNotice, Field, Modal, Notice, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { TimeInput } from "@/components/TimeInput";
import { ProjectGate, SaveIndicator } from "@/features/projects/ProjectGate";
import { useProject } from "@/features/projects/ProjectContext";
import { usePlayback } from "@/features/editor/usePlayback";
import { Stage } from "@/features/editor/Stage";
import { Transport } from "@/features/editor/Transport";
import { Timeline, type Selection } from "@/features/editor/Timeline";
import { appendMedia, mediaPaths, moveClip, removeClip, splitAt } from "@/features/editor/ops";
import { buildSpec, clipDuration, clipStarts } from "@/features/editor/spec";
import { ExportDialog } from "@/features/editor/ExportDialog";
import { useJob } from "@/hooks/useJob";
import { useThumbnail } from "@/hooks/useThumbnail";
import { importMedia, renderPreview } from "@/services/media";
import { checkFfmpeg } from "@/services/system";
import { errorText, fileUrl } from "@/services/tauri";
import { formatBytes, formatTime } from "@/services/format";

function MediaTile({ m, onAdd }: { m: MediaInfo; onAdd: () => void }) {
  const thumb = useThumbnail(m.path, m.kind, 1);
  return (
    <button type="button" className="media-tile" onDoubleClick={onAdd} title={`${m.path}\nДвойной щелчок — добавить на Timeline`}>
      <div className="media-tile__thumb">
        {thumb ? <img src={thumb} alt="" /> : m.kind === "audio" ? <AudioLines size={22} /> : <Film size={22} />}
        {m.kind !== "image" && <span className="media-tile__badge">{formatTime(m.duration, false)}</span>}
      </div>
      <div className="media-tile__body">
        <span className="media-tile__title">{m.name}</span>
        <span className="media-tile__meta">
          {m.kind === "audio" ? "Аудио" : `${m.width}×${m.height}`} · {formatBytes(m.size)}
        </span>
        <span className="row" style={{ gap: 4 }}>
          <span className="btn btn--secondary btn--sm" role="button" onClick={onAdd}>
            <Plus size={12} /> На Timeline
          </span>
        </span>
      </div>
    </button>
  );
}

function Inspector({ data, sel, onChange, time, onClose }: {
  data: ProjectData;
  sel: Selection;
  onChange: (fn: (d: ProjectData) => ProjectData, coalesce?: string) => void;
  time: number;
  onClose: () => void;
}) {
  if (!sel) return null;
  if (sel.kind === "clip") {
    const c = data.clips.find((x) => x.id === sel.id);
    if (!c) return null;
    const set = (patch: Partial<typeof c>, key?: string) =>
      onChange((d) => ({ ...d, clips: d.clips.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }), key);
    const max = c.kind === "image" ? 3600 : c.sourceDuration;
    return (
      <div className="stack">
        <div className="row">
          <strong className="truncate" style={{ flex: 1 }}>{c.name}</strong>
          <Button size="sm" iconOnly icon={X} onClick={onClose} title="Снять выделение" />
        </div>
        {c.adAssetId ? <span className="badge">Рекламная вставка</span> : null}
        <div className="grid grid-2">
          <Field label={c.kind === "image" ? "Начало" : "Вход (в исходнике)"}>
            <TimeInput value={c.inPoint} max={c.outPoint - 0.1} onChange={(v) => set({ inPoint: v })} disabled={c.kind === "image"} />
          </Field>
          <Field label={c.kind === "image" ? "Длительность" : "Выход (в исходнике)"}>
            <TimeInput value={c.outPoint} min={c.inPoint + 0.1} max={max} onChange={(v) => set({ outPoint: v })} />
          </Field>
        </div>
        <div className="small muted">Длительность фрагмента: {formatTime(clipDuration(c))}</div>
        {c.kind === "video" && (
          <Field label={`Громкость: ${Math.round(c.volume * 100)}%`}>
            <input className="range" type="range" min={0} max={2} step={0.05} value={c.volume} disabled={!c.hasAudio} onChange={(e) => set({ volume: +e.target.value }, `vol-${c.id}`)} />
          </Field>
        )}
        {c.kind === "video" && !c.hasAudio && <div className="small muted">В исходнике нет звуковой дорожки.</div>}
        <div className="row">
          <Button size="sm" icon={ArrowLeft} onClick={() => onChange((d) => moveClip(d, c.id, -1))}>Раньше</Button>
          <Button size="sm" icon={ArrowRight} onClick={() => onChange((d) => moveClip(d, c.id, 1))}>Позже</Button>
          <Button size="sm" icon={Trash2} onClick={() => { onChange((d) => removeClip(d, c.id)); onClose(); }}>Удалить</Button>
        </div>
      </div>
    );
  }
  if (sel.kind === "audio") {
    const a = data.audio.find((x) => x.id === sel.id);
    if (!a) return null;
    const set = (patch: Partial<typeof a>, key?: string) =>
      onChange((d) => ({ ...d, audio: d.audio.map((x) => (x.id === a.id ? { ...x, ...patch } : x)) }), key);
    return (
      <div className="stack">
        <div className="row">
          <strong className="truncate" style={{ flex: 1 }}>{a.name}</strong>
          <Button size="sm" iconOnly icon={X} onClick={onClose} />
        </div>
        <Field label="Позиция на Timeline">
          <div className="input-group">
            <TimeInput value={a.start} onChange={(v) => set({ start: v })} />
            <Button size="sm" onClick={() => set({ start: time })}>Курсор</Button>
          </div>
        </Field>
        <div className="grid grid-2">
          <Field label="Вход"><TimeInput value={a.inPoint} max={a.outPoint - 0.1} onChange={(v) => set({ inPoint: v })} /></Field>
          <Field label="Выход"><TimeInput value={a.outPoint} min={a.inPoint + 0.1} max={a.sourceDuration} onChange={(v) => set({ outPoint: v })} /></Field>
        </div>
        <Field label={`Громкость: ${Math.round(a.volume * 100)}%`}>
          <input className="range" type="range" min={0} max={2} step={0.05} value={a.volume} onChange={(e) => set({ volume: +e.target.value }, `avol-${a.id}`)} />
        </Field>
        <Button size="sm" icon={Trash2} onClick={() => { onChange((d) => ({ ...d, audio: d.audio.filter((x) => x.id !== a.id) })); onClose(); }}>
          Удалить с Timeline
        </Button>
      </div>
    );
  }
  if (sel.kind === "overlay") {
    const o = data.overlays.find((x) => x.id === sel.id);
    if (!o) return null;
    const set = (patch: Partial<typeof o>, key?: string) =>
      onChange((d) => ({ ...d, overlays: d.overlays.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) }), key);
    return (
      <div className="stack">
        <div className="row">
          <strong className="truncate" style={{ flex: 1 }}>{o.name}</strong>
          <Button size="sm" iconOnly icon={X} onClick={onClose} />
        </div>
        <div className="grid grid-2">
          <Field label="Начало"><TimeInput value={o.start} max={o.end - 0.1} onChange={(v) => set({ start: v })} /></Field>
          <Field label="Конец"><TimeInput value={o.end} min={o.start + 0.1} onChange={(v) => set({ end: v })} /></Field>
        </div>
        <Field label={`Положение по горизонтали: ${Math.round(o.x * 100)}%`}>
          <input className="range" type="range" min={0} max={1} step={0.01} value={o.x} onChange={(e) => set({ x: +e.target.value }, `ox-${o.id}`)} />
        </Field>
        <Field label={`Положение по вертикали: ${Math.round(o.y * 100)}%`}>
          <input className="range" type="range" min={0} max={1} step={0.01} value={o.y} onChange={(e) => set({ y: +e.target.value }, `oy-${o.id}`)} />
        </Field>
        <Field label={`Размер: ${Math.round(o.width * 100)}% ширины`}>
          <input className="range" type="range" min={0.03} max={1} step={0.01} value={o.width} onChange={(e) => set({ width: +e.target.value }, `ow-${o.id}`)} />
        </Field>
        <Field label={`Непрозрачность: ${Math.round(o.opacity * 100)}%`}>
          <input className="range" type="range" min={0.05} max={1} step={0.05} value={o.opacity} onChange={(e) => set({ opacity: +e.target.value }, `oo-${o.id}`)} />
        </Field>
        <div className="row">
          {[["↖", 0.12, 0.1], ["↗", 0.88, 0.1], ["↙", 0.12, 0.9], ["↘", 0.88, 0.9], ["Центр", 0.5, 0.5]].map(([l, x, y]) => (
            <Button key={l as string} size="sm" onClick={() => set({ x: x as number, y: y as number })}>{l as string}</Button>
          ))}
        </div>
        <Button size="sm" icon={Trash2} onClick={() => { onChange((d) => ({ ...d, overlays: d.overlays.filter((x) => x.id !== o.id) })); onClose(); }}>
          Удалить наложение
        </Button>
      </div>
    );
  }
  const c = data.subtitles.cues.find((x) => x.id === sel.id);
  if (!c) return null;
  return (
    <div className="stack">
      <div className="row">
        <strong style={{ flex: 1 }}>Субтитр</strong>
        <Button size="sm" iconOnly icon={X} onClick={onClose} />
      </div>
      <textarea
        className="textarea"
        rows={3}
        value={c.text}
        onChange={(e) =>
          onChange((d) => ({ ...d, subtitles: { ...d.subtitles, cues: d.subtitles.cues.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) } }), `cue-${c.id}`)
        }
      />
      <div className="small muted">{formatTime(c.start)} → {formatTime(c.end)}. Полное редактирование — в разделе «Субтитры».</div>
    </div>
  );
}

export function EditorPage({ navigate }: PageProps) {
  const { project, update, undo, redo, canUndo, canRedo, missingFiles, rename } = useProject();
  const data = project?.data ?? null;
  const pb = usePlayback(data);
  const [sel, setSel] = useState<Selection>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const previewJob = useJob();

  useEffect(() => {
    checkFfmpeg().then((s) => setFfmpegOk(s.found)).catch(() => setFfmpegOk(null));
  }, []);

  const doImport = useCallback(
    async (kind: "video" | "audio" | "image" | "any", toTimeline: boolean) => {
      setErr(null);
      try {
        const items = await importMedia(kind, true);
        if (!items.length) return;
        update((d) => (toTimeline ? appendMedia(d, items, kind === "audio" ? pb.time : undefined) : { ...d, media: [...d.media, ...items.filter((m) => !d.media.some((x) => x.path === m.path))] }));
      } catch (e) {
        setErr(errorText(e));
      }
    },
    [update, pb.time],
  );

  const split = useCallback(() => {
    if (!data) return;
    const r = splitAt(data, pb.time);
    if (r) update(() => r);
    else setErr("Курсор слишком близко к границе фрагмента — разрезать нельзя.");
  }, [data, pb.time, update]);

  const deleteSelected = useCallback(() => {
    if (!sel) return;
    if (sel.kind === "clip") update((d) => removeClip(d, sel.id));
    if (sel.kind === "audio") update((d) => ({ ...d, audio: d.audio.filter((a) => a.id !== sel.id) }));
    if (sel.kind === "overlay") update((d) => ({ ...d, overlays: d.overlays.filter((a) => a.id !== sel.id) }));
    if (sel.kind === "cue") update((d) => ({ ...d, subtitles: { ...d.subtitles, cues: d.subtitles.cues.filter((a) => a.id !== sel.id) } }));
    setSel(null);
  }, [sel, update]);

  // Горячие клавиши.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); pb.toggle(); }
      else if (e.key === "s" || e.key === "S" || e.key === "ы" || e.key === "Ы") { if (!e.ctrlKey) split(); }
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "ArrowLeft") pb.step(e.shiftKey ? -1 : -1 / 30);
      else if (e.key === "ArrowRight") pb.step(e.shiftKey ? 1 : 1 / 30);
      else if (e.key === "Home") pb.seek(0);
      else if (e.key === "End") pb.seek(pb.total);
      else if (e.ctrlKey && (e.key === "z" || e.key === "я")) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.ctrlKey && (e.key === "y" || e.key === "н")) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [pb, split, deleteSelected, undo, redo]);

  const startPreview = async () => {
    if (!data) return;
    pb.pause();
    const r = await previewJob.run((jobId) => renderPreview(jobId, buildSpec(data, { resolution: 720 })), "Сборка предпросмотра…");
    if (r) setPreview(fileUrl(r.path) + `?t=${Date.now()}`);
  };

  const markers = useMemo(() => (data ? clipStarts(data.clips).slice(1) : []), [data]);
  const missing = useMemo(() => (data ? mediaPaths(data).filter((p) => missingFiles.includes(p)) : []), [data, missingFiles]);

  return (
    <div className="page">
      <PageHeader
        title="Видеоредактор"
        description="Импорт, обрезка, разрезание, порядок фрагментов, звук, формат кадра и экспорт в MP4 через локальный FFmpeg."
        actions={
          project && (
            <>
              <SaveIndicator />
              <Button size="sm" iconOnly icon={Undo2} title="Отменить (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
              <Button size="sm" iconOnly icon={Redo2} title="Повторить (Ctrl+Y)" disabled={!canRedo} onClick={redo} />
              <Button icon={Eye} onClick={startPreview} disabled={!data?.clips.length || previewJob.running || ffmpegOk === false}>
                Предпросмотр FFmpeg
              </Button>
              <Button variant="primary" icon={Download} onClick={() => setExporting(true)} disabled={!data?.clips.length || ffmpegOk === false}>
                Экспорт
              </Button>
            </>
          )
        }
      />
      <ProjectGate navigate={navigate} text="Создайте проект или откройте существующий, чтобы начать монтаж.">
        {project && data && (
          <>
            {ffmpegOk === false && (
              <Notice>
                FFmpeg не найден — предпросмотр и экспорт недоступны. Укажите путь к ffmpeg.exe в{" "}
                <a href="#/settings">Настройках</a>.
              </Notice>
            )}
            {missing.length > 0 && (
              <Notice>
                Не найдены исходные файлы ({missing.length}): {missing.slice(0, 3).join(", ")}
                {missing.length > 3 ? "…" : ""}. Верните их на место или удалите фрагменты с Timeline.
              </Notice>
            )}
            <ErrorNotice error={err} onClose={() => setErr(null)} />

            <div className="grid grid-sidebar">
              <Card
                title={
                  <input
                    className="inline-edit"
                    defaultValue={project.name}
                    key={project.id + project.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== project.name && rename(e.target.value).catch((x) => setErr(errorText(x)))}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    style={{ fontWeight: 600, fontSize: "var(--fs-lg)" }}
                  />
                }
              >
                <div className="stack">
                  <Stage data={data} pb={pb} maxHeight={440} emptyText="Импортируйте видео, чтобы начать" />
                  <Transport pb={pb} fps={data.export.fps} />
                </div>
              </Card>

              <div className="stack">
                <Card title="Кадр">
                  <div className="stack">
                    <Field label="Соотношение сторон">
                      <Segmented<AspectRatio>
                        value={data.aspectRatio}
                        onChange={(v) => update((d) => ({ ...d, aspectRatio: v }))}
                        options={[{ value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }]}
                      />
                    </Field>
                    <Field label="Вписывание исходника">
                      <Segmented<Fit>
                        value={data.fit}
                        onChange={(v) => update((d) => ({ ...d, fit: v }))}
                        options={[{ value: "crop", label: "Заполнить" }, { value: "fit", label: "Вписать" }, { value: "blur", label: "Размытый фон" }]}
                      />
                    </Field>
                    <Field label={`Общая громкость: ${Math.round(data.masterVolume * 100)}%`}>
                      <input className="range" type="range" min={0} max={2} step={0.05} value={data.masterVolume} onChange={(e) => update((d) => ({ ...d, masterVolume: +e.target.value }), "master-vol")} />
                    </Field>
                    <div className="small muted">Разрешение и FPS выбираются при экспорте.</div>
                  </div>
                </Card>
                <Card title={sel ? "Свойства" : "Импорт"}>
                  {sel ? (
                    <Inspector data={data} sel={sel} onChange={update} time={pb.time} onClose={() => setSel(null)} />
                  ) : (
                    <div className="stack">
                      <Button icon={Film} onClick={() => doImport("video", true)}>Видео на Timeline</Button>
                      <Button icon={ImagePlus} onClick={() => doImport("image", true)}>Изображение на Timeline</Button>
                      <Button icon={Music} onClick={() => doImport("audio", true)}>Аудио с позиции курсора</Button>
                      <Button icon={Plus} onClick={() => doImport("any", false)}>В медиатеку проекта</Button>
                      <div className="small muted">Файлы не копируются и не изменяются — проект хранит только путь к ним.</div>
                    </div>
                  )}
                </Card>
              </div>
            </div>

            <Timeline
              data={data}
              time={pb.time}
              onSeek={pb.seek}
              selection={sel}
              onSelect={setSel}
              onChange={update}
              markers={markers}
              toolbar={
                <>
                  <Button size="sm" icon={Scissors} onClick={split} disabled={!data.clips.length} title="Разрезать под курсором (S)">Разрезать</Button>
                  <Button size="sm" icon={Trash2} onClick={deleteSelected} disabled={!sel} title="Удалить выделенное (Delete)">Удалить</Button>
                  <span className="small muted">Края фрагментов перетаскиваются для обрезки · Пробел — пуск/пауза</span>
                </>
              }
            />

            {data.media.length > 0 && (
              <Card title="Медиатека проекта" subtitle={`${data.media.length} файл(ов)`}>
                <div className="media-grid">
                  {data.media.map((m) => (
                    <MediaTile key={m.path} m={m} onAdd={() => update((d) => appendMedia(d, [m], m.kind === "audio" ? pb.time : undefined))} />
                  ))}
                </div>
              </Card>
            )}

            {(previewJob.running || previewJob.error) && (
              <Card title="Предпросмотр FFmpeg">
                {previewJob.running && (
                  <div className="row">
                    <div style={{ flex: 1 }}><ProgressBar value={previewJob.progress} label={previewJob.message} /></div>
                    <Button size="sm" icon={X} onClick={previewJob.cancel}>Отменить</Button>
                  </div>
                )}
                <ErrorNotice error={previewJob.error} onClose={previewJob.clearError} />
              </Card>
            )}
          </>
        )}
      </ProjectGate>

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {preview && (
        <Modal title="Предпросмотр (FFmpeg, 720p)" onClose={() => setPreview(null)} width={880}>
          <video src={preview} controls autoPlay style={{ width: "100%", maxHeight: "70vh", background: "#000", borderRadius: 8 }} />
          <div className="small muted">Так будет выглядеть результат экспорта: обрезка, кадр, звук, наложения и субтитры.</div>
        </Modal>
      )}
    </div>
  );
}
