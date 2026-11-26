import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, Download, FileUp, Merge, Mic, Plus, Scissors, Trash2, X } from "lucide-react";
import type { PageProps } from "@/app/App";
import type { Cue, SubtitleStyle, WhisperStatus } from "@/types";
import { Button, Card, EmptyState, ErrorNotice, Field, Notice, PageHeader, ProgressBar, Segmented, StatusBadge, Toggle } from "@/components/ui";
import { TimeInput } from "@/components/TimeInput";
import { ProjectGate, SaveIndicator } from "@/features/projects/ProjectGate";
import { useProject } from "@/features/projects/ProjectContext";
import { usePlayback } from "@/features/editor/usePlayback";
import { Stage } from "@/features/editor/Stage";
import { Transport } from "@/features/editor/Transport";
import { buildSpec } from "@/features/editor/spec";
import { ANIMATIONS, DEFAULT_SUBTITLE_STYLE, FONTS, STYLE_PRESETS, TEXT_COLORS } from "@/features/subtitles/presets";
import { useJob } from "@/hooks/useJob";
import { exportSrt, importSrt, transcribe } from "@/services/media";
import { whisperStatus } from "@/services/system";
import { errorText, newId } from "@/services/tauri";
import { formatTime } from "@/services/format";

type Lang = "ru" | "en" | "auto";
const sortCues = (c: Cue[]) => [...c].sort((a, b) => a.start - b.start);

export function SubtitlesPage({ navigate }: PageProps) {
  const { project, update } = useProject();
  const data = project?.data ?? null;
  const pb = usePlayback(data);
  const job = useJob();
  const [ws, setWs] = useState<WhisperStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    whisperStatus().then(setWs).catch(() => setWs(null));
  }, []);

  const subs = data?.subtitles;
  const cues = subs?.cues ?? [];
  const style = subs?.style ?? DEFAULT_SUBTITLE_STYLE;
  const activeIdx = useMemo(() => cues.findIndex((c) => pb.time >= c.start && pb.time < c.end), [cues, pb.time]);

  useEffect(() => {
    if (!follow || activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cue="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, follow]);

  const setCues = (fn: (c: Cue[]) => Cue[], coalesce?: string) =>
    update((d) => ({ ...d, subtitles: { ...d.subtitles, cues: fn(d.subtitles.cues) } }), coalesce);
  const setStyle = (patch: Partial<SubtitleStyle>, coalesce?: string) =>
    update((d) => ({ ...d, subtitles: { ...d.subtitles, style: { ...d.subtitles.style, ...patch } } }), coalesce);
  const patchCue = (id: string, patch: Partial<Cue>, coalesce?: string) =>
    setCues((c) => sortCues(c.map((x) => (x.id === id ? { ...x, ...patch } : x))), coalesce);

  const runWhisper = async () => {
    if (!data) return;
    pb.pause();
    const lang = data.subtitles.language;
    const r = await job.run((id) => transcribe(id, buildSpec(data, { withSubtitles: false, resolution: 360 }), lang), "Подготовка…");
    if (!r) return;
    const fresh = r.map((c) => ({ id: newId(), start: c.start, end: c.end, text: c.text }));
    setCues((old) => (replace ? fresh : sortCues([...old, ...fresh])));
    update((d) => ({ ...d, subtitles: { ...d.subtitles, enabled: true } }));
  };

  const addCue = () => {
    const start = pb.time;
    setCues((c) => {
      const next = c.find((x) => x.start > start);
      const end = Math.min(start + 2, next ? next.start : start + 2, pb.total || start + 2);
      return sortCues([...c, { id: newId(), start, end: Math.max(end, start + 0.3), text: "Новый субтитр" }]);
    });
  };
  const splitCue = (c: Cue) => {
    const words = c.text.trim().split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    const t = pb.time > c.start + 0.1 && pb.time < c.end - 0.1 ? pb.time : (c.start + c.end) / 2;
    setCues((all) =>
      sortCues(
        all.flatMap((x) =>
          x.id !== c.id
            ? [x]
            : [
                { ...x, end: t, text: words.slice(0, mid).join(" ") || x.text },
                { id: newId(), start: t, end: x.end, text: words.slice(mid).join(" ") || x.text },
              ],
        ),
      ),
    );
  };
  const mergeNext = (i: number) =>
    setCues((all) => {
      if (i >= all.length - 1) return all;
      const a = all[i], b = all[i + 1];
      return [...all.slice(0, i), { ...a, end: b.end, text: `${a.text} ${b.text}`.trim() }, ...all.slice(i + 2)];
    });
  const shiftAll = (dt: number) => setCues((all) => all.map((c) => ({ ...c, start: Math.max(0, c.start + dt), end: Math.max(0.1, c.end + dt) })));

  const doImport = async () => {
    try {
      const r = await importSrt();
      if (!r) return;
      setCues(() => sortCues(r.map((c) => ({ id: newId(), ...c }))));
      update((d) => ({ ...d, subtitles: { ...d.subtitles, enabled: true } }));
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const doExport = async () => {
    try {
      await exportSrt(cues.map(({ start, end, text }) => ({ start, end, text })), `${project?.name ?? "subtitles"}.srt`);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const whisperReady = ws?.binaryFound && ws?.modelFound;
  const overlaps = useMemo(() => cues.filter((c, i) => i > 0 && c.start < cues[i - 1].end - 0.01).length, [cues]);

  return (
    <div className="page">
      <PageHeader
        title="Субтитры"
        description="Локальное распознавание речи (whisper.cpp, русский и английский), ручное редактирование текста и таймингов, стиль и анимации."
        actions={project && <SaveIndicator />}
      />
      <ProjectGate navigate={navigate} text="Субтитры создаются для монтажа проекта. Откройте или создайте проект.">
        {project && data && subs && (
          <>
            <ErrorNotice error={err} onClose={() => setErr(null)} />
            <div className="grid grid-sidebar">
              <Card title="Предпросмотр" subtitle="Субтитры поверх кадра — так же, как при экспорте">
                {data.clips.length ? (
                  <div className="stack">
                    <Stage data={data} pb={pb} maxHeight={420} showSubtitles={subs.enabled} />
                    <Transport pb={pb} fps={data.export.fps} />
                  </div>
                ) : (
                  <EmptyState
                    icon={Captions}
                    title="Timeline пуст"
                    text="Добавьте видео в редакторе — распознавание идёт по звуку смонтированного ролика."
                    action={<Button onClick={() => navigate("editor")}>Открыть редактор</Button>}
                  />
                )}
              </Card>

              <div className="stack">
                <Card title="Распознавание" subtitle="whisper.cpp, офлайн">
                  <div className="stack">
                    <div className="row">
                      <StatusBadge on={!!ws?.binaryFound} label={ws?.binaryFound ? "whisper-cli найден" : "whisper-cli не найден"} />
                      <StatusBadge on={!!ws?.modelFound} label={ws?.modelFound ? "Модель выбрана" : "Модель не выбрана"} />
                    </div>
                    {!whisperReady && (
                      <Notice>
                        Укажите whisper-cli.exe и модель ggml-*.bin в{" "}
                        <a href="#/settings" className="link">Настройках</a>. Инструкция — в README.
                      </Notice>
                    )}
                    <Field label="Язык речи">
                      <Segmented<Lang>
                        value={subs.language}
                        onChange={(v) => update((d) => ({ ...d, subtitles: { ...d.subtitles, language: v } }))}
                        options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }, { value: "auto", label: "Авто" }]}
                      />
                    </Field>
                    <Toggle checked={replace} onChange={setReplace} label="Заменить текущие субтитры" />
                    {job.running ? (
                      <div className="row">
                        <div style={{ flex: 1 }}><ProgressBar value={job.progress} label={job.message} /></div>
                        <Button size="sm" icon={X} onClick={job.cancel}>Отмена</Button>
                      </div>
                    ) : (
                      <Button variant="primary" icon={Mic} onClick={runWhisper} disabled={!whisperReady || !data.clips.length}>
                        Распознать речь
                      </Button>
                    )}
                    <ErrorNotice error={job.error} onClose={job.clearError} />
                  </div>
                </Card>
                <Card title="Файлы">
                  <div className="stack">
                    <Toggle
                      checked={subs.enabled}
                      onChange={(v) => update((d) => ({ ...d, subtitles: { ...d.subtitles, enabled: v } }))}
                      label="Показывать и вшивать при экспорте"
                    />
                    <div className="row">
                      <Button size="sm" icon={FileUp} onClick={doImport}>Импорт SRT</Button>
                      <Button size="sm" icon={Download} onClick={doExport} disabled={!cues.length}>Экспорт SRT</Button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            <div className="grid grid-sidebar">
              <Card
                title="Реплики"
                subtitle={`${cues.length} шт.${overlaps ? ` · пересечений: ${overlaps}` : ""}`}
                actions={
                  <div className="row" style={{ gap: 6 }}>
                    <Toggle checked={follow} onChange={setFollow} label="Следовать" />
                    <Button size="sm" onClick={() => shiftAll(-0.1)} disabled={!cues.length} title="Сдвинуть все на −0,1 с">−0,1 с</Button>
                    <Button size="sm" onClick={() => shiftAll(0.1)} disabled={!cues.length} title="Сдвинуть все на +0,1 с">+0,1 с</Button>
                    <Button size="sm" icon={Plus} onClick={addCue}>Добавить у курсора</Button>
                  </div>
                }
              >
                {cues.length === 0 ? (
                  <div className="muted small">Субтитров пока нет. Распознайте речь, импортируйте SRT или добавьте реплику вручную.</div>
                ) : (
                  <div className="cue-list" ref={listRef}>
                    {cues.map((c, i) => (
                      <div key={c.id} data-cue={i} className={`cue ${i === activeIdx ? "is-active" : ""}`}>
                        <TimeInput value={c.start} max={c.end - 0.05} onChange={(v) => patchCue(c.id, { start: v })} title="Начало" />
                        <TimeInput value={c.end} min={c.start + 0.05} onChange={(v) => patchCue(c.id, { end: v })} title="Конец" />
                        <textarea
                          className="input"
                          rows={1}
                          style={{ height: "auto", minHeight: 34, resize: "vertical" }}
                          value={c.text}
                          onFocus={() => pb.seek(c.start + 0.01)}
                          onChange={(e) => patchCue(c.id, { text: e.target.value }, `cue-${c.id}`)}
                        />
                        <div className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
                          <Button size="sm" iconOnly icon={Scissors} title="Разделить (по курсору или пополам)" onClick={() => splitCue(c)} />
                          <Button size="sm" iconOnly icon={Merge} title="Объединить со следующей" disabled={i === cues.length - 1} onClick={() => mergeNext(i)} />
                          <Button size="sm" iconOnly icon={Trash2} title="Удалить" onClick={() => setCues((all) => all.filter((x) => x.id !== c.id))} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="small muted" style={{ marginTop: 8 }}>
                  Время: {formatTime(pb.time)}. Фокус на тексте переносит курсор к реплике.
                </div>
              </Card>

              <Card title="Стиль">
                <div className="stack">
                  <Field label="Пресеты">
                    <div className="row" style={{ gap: 6 }}>
                      {STYLE_PRESETS.map((p) => (
                        <button key={p.name} type="button" className="chip" onClick={() => setStyle(p.style)}>{p.name}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Шрифт">
                    <select className="select" value={style.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
                      {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Field>
                  <Field label={`Размер: ${style.fontSize}px (при высоте 1080)`}>
                    <input className="range" type="range" min={24} max={140} value={style.fontSize} onChange={(e) => setStyle({ fontSize: +e.target.value }, "sub-size")} />
                  </Field>
                  <Field label="Цвет текста">
                    <div className="row" style={{ gap: 6 }}>
                      {TEXT_COLORS.map((c) => (
                        <button key={c} type="button" className={`swatch ${style.color.toUpperCase() === c ? "is-active" : ""}`} style={{ background: c }} onClick={() => setStyle({ color: c })} title={c} />
                      ))}
                      <input type="color" value={style.color} onChange={(e) => setStyle({ color: e.target.value.toUpperCase() }, "sub-color")} className="swatch" title="Свой цвет" />
                    </div>
                  </Field>
                  <Field label={`Обводка: ${style.outlineWidth}px`}>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <input className="range" type="range" min={0} max={12} value={style.outlineWidth} onChange={(e) => setStyle({ outlineWidth: +e.target.value }, "sub-ow")} />
                      <input type="color" value={style.outlineColor} onChange={(e) => setStyle({ outlineColor: e.target.value.toUpperCase() }, "sub-oc")} className="swatch" title="Цвет обводки" />
                    </div>
                  </Field>
                  <div className="row">
                    <Toggle checked={style.shadow} onChange={(v) => setStyle({ shadow: v })} label="Тень" />
                    <Toggle checked={style.bold} onChange={(v) => setStyle({ bold: v })} label="Жирный" />
                    <Toggle checked={style.uppercase} onChange={(v) => setStyle({ uppercase: v })} label="ВЕРХНИЙ РЕГИСТР" />
                  </div>
                  <Field label="Позиция">
                    <Segmented<SubtitleStyle["position"]>
                      value={style.position}
                      onChange={(v) => setStyle({ position: v })}
                      options={[{ value: "top", label: "Сверху" }, { value: "middle", label: "Центр" }, { value: "bottom", label: "Снизу" }]}
                    />
                  </Field>
                  <Field label="Анимация">
                    <select className="select" value={style.animation} onChange={(e) => setStyle({ animation: e.target.value as SubtitleStyle["animation"] })}>
                      {ANIMATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                  </Field>
                  <Button size="sm" onClick={() => setStyle(DEFAULT_SUBTITLE_STYLE)}>Сбросить стиль</Button>
                </div>
              </Card>
            </div>
          </>
        )}
      </ProjectGate>
    </div>
  );
}
