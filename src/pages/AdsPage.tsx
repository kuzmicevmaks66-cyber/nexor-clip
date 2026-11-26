import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderPlus, Image as ImageIcon, Megaphone, Pencil, Plus, Sparkles, Trash2, Upload, Video, Wand2, X } from "lucide-react";
import type { PageProps } from "@/app/App";
import type { AdRules } from "@/types/project";
import { Button, Card, EmptyState, ErrorNotice, Field, Modal, Notice, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { TimeInput } from "@/components/TimeInput";
import { useProject } from "@/features/projects/ProjectContext";
import { buildSpec, timelineDuration } from "@/features/editor/spec";
import { applyPlan, choosePoints, collectCandidates, insideSpeech, nearestSafePoint, placeAsset, type Candidate } from "@/features/advertising/placement";
import { useJob } from "@/hooks/useJob";
import { useThumbnail } from "@/hooks/useThumbnail";
import { removeClip } from "@/features/editor/ops";
import {
  adCreateCategory, adDeleteAsset, adDeleteCategory, adImport, adListAssets, adListCategories, adRenameCategory, adUpdateAsset,
  type AdAsset, type AdCategory,
} from "@/services/ads";
import { detectSilences } from "@/services/media";
import { errorText, fileUrl, isDesktop } from "@/services/tauri";
import { formatBytes, formatTime } from "@/services/format";

const KIND_LABEL: Record<AdAsset["kind"], string> = { video: "Видео", image: "Изображение", logo: "Логотип" };

function AssetTile({ a, selected, onSelect }: { a: AdAsset; selected: boolean; onSelect: () => void }) {
  const thumb = useThumbnail(a.exists ? a.path : null, a.kind === "video" ? "video" : "image", 1);
  return (
    <button type="button" className={`media-tile ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <div className="media-tile__thumb">
        {thumb ? <img src={thumb} alt="" style={a.kind === "logo" ? { objectFit: "contain" } : undefined} /> : a.kind === "video" ? <Video size={22} /> : <ImageIcon size={22} />}
        {a.duration ? <span className="media-tile__badge">{formatTime(a.duration, false)}</span> : null}
      </div>
      <div className="media-tile__body">
        <span className="media-tile__title">{a.name}</span>
        <span className="media-tile__meta">{a.exists ? `${KIND_LABEL[a.kind]} · ${formatBytes(a.size)}` : "Файл не найден"}</span>
      </div>
    </button>
  );
}

interface PlanItem { at: number; source: Candidate["source"]; assetId: number }

export function AdsPage({ navigate }: PageProps) {
  const { project, update, ensure } = useProject();
  const [cats, setCats] = useState<AdCategory[]>([]);
  const [assets, setAssets] = useState<AdAsset[]>([]);
  const [filter, setFilter] = useState<number | "all" | "none">("all");
  const [selId, setSelId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catDialog, setCatDialog] = useState<{ id: number | null; name: string } | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [at, setAt] = useState(0);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [silences, setSilences] = useState<[number, number][]>([]);
  const job = useJob();

  const reload = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const [c, a] = await Promise.all([adListCategories(), adListAssets()]);
      setCats(c);
      setAssets(a);
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const shown = assets.filter((a) => (filter === "all" ? true : filter === "none" ? a.categoryId == null : a.categoryId === filter));
  const sel = assets.find((a) => a.id === selId) ?? null;
  useEffect(() => setEditName(sel?.name ?? ""), [sel?.id, sel?.name]);

  const doImport = async (kind: AdAsset["kind"]) => {
    try {
      const n = await adImport(kind, typeof filter === "number" ? filter : null);
      if (n > 0) await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const saveCategory = async () => {
    if (!catDialog || !catDialog.name.trim()) return;
    try {
      if (catDialog.id == null) await adCreateCategory(catDialog.name.trim());
      else await adRenameCategory(catDialog.id, catDialog.name.trim());
      setCatDialog(null);
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const removeCategory = async (c: AdCategory) => {
    if (!confirm(`Удалить категорию «${c.name}»? Материалы останутся без категории, файлы не удаляются.`)) return;
    try {
      await adDeleteCategory(c.id);
      if (filter === c.id) setFilter("all");
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const updateSel = async (patch: Partial<Pick<AdAsset, "name" | "categoryId" | "kind">>) => {
    if (!sel) return;
    const n = { ...sel, ...patch };
    try {
      await adUpdateAsset(n.id, n.name.trim() || sel.name, n.categoryId, n.kind);
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const removeSel = async () => {
    if (!sel || !confirm(`Убрать «${sel.name}» из библиотеки? Сам файл на диске не удаляется.`)) return;
    try {
      await adDeleteAsset(sel.id);
      setSelId(null);
      await reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const data = project?.data ?? null;
  const total = data ? timelineDuration(data.clips) : 0;
  const rules = data?.adRules;
  const setRules = (patch: Partial<AdRules>, key?: string) => update((d) => ({ ...d, adRules: { ...d.adRules, ...patch } }), key);

  const safeAt = data ? nearestSafePoint(data, at, silences) : 0;
  const addSelected = async () => {
    if (!sel) return;
    try {
      await ensure("Проект с рекламой");
      update((d) => placeAsset(d, sel, nearestSafePoint(d, at, silences), d.adRules.overlayDuration));
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const ruleAssets = useMemo(() => (rules ? assets.filter((a) => rules.assetIds.includes(a.id) && a.exists) : []), [assets, rules]);

  const buildPlan = async () => {
    if (!data || !rules) return;
    let sil: [number, number][] = [];
    if (rules.where !== "cuts") {
      const r = await job.run((id) => detectSilences(id, buildSpec(data, { withSubtitles: false, resolution: 360 }), rules.noiseDb, rules.minPause), "Анализ пауз в речи…");
      if (!r) return;
      sil = r;
      setSilences(r);
    }
    const chosen = choosePoints(data, rules, collectCandidates(data, rules, sil));
    setPlan(chosen.map((c, i) => ({ at: c.at, source: c.source, assetId: ruleAssets[i % ruleAssets.length].id })));
  };
  const applyCurrentPlan = () => {
    if (!plan) return;
    const items = plan.flatMap((p) => {
      const a = assets.find((x) => x.id === p.assetId);
      return a ? [{ at: p.at, asset: a }] : [];
    });
    update((d) => applyPlan(d, items, d.adRules.overlayDuration));
    setPlan(null);
  };

  const removeAllAds = () =>
    update((d) => {
      const ids = d.clips.filter((c) => c.adAssetId != null).map((c) => c.id);
      const next = ids.reduce((acc, id) => removeClip(acc, id, true), d);
      return { ...next, overlays: next.overlays.filter((o) => o.adAssetId == null) };
    });

  const adsInProject = data ? data.clips.filter((c) => c.adAssetId != null).length + data.overlays.filter((o) => o.adAssetId != null).length : 0;

  return (
    <div className="page">
      <PageHeader
        title="Реклама"
        description="Локальная библиотека рекламных роликов, изображений и логотипов. Материалы не загружаются из интернета — только ваши файлы."
        actions={
          <>
            <Button icon={Upload} onClick={() => doImport("video")} disabled={!isDesktop()}>Видео</Button>
            <Button icon={Upload} onClick={() => doImport("image")} disabled={!isDesktop()}>Изображения</Button>
            <Button variant="primary" icon={Upload} onClick={() => doImport("logo")} disabled={!isDesktop()}>Логотипы</Button>
          </>
        }
      />
      <ErrorNotice error={err} onClose={() => setErr(null)} />
      {!isDesktop() && <Notice>Библиотека рекламы хранится локально и доступна в desktop-приложении.</Notice>}

      <div className="grid grid-sidebar">
        <Card
          title="Библиотека"
          subtitle={`${assets.length} материал(ов)`}
          actions={<Button size="sm" icon={FolderPlus} onClick={() => setCatDialog({ id: null, name: "" })} disabled={!isDesktop()}>Категория</Button>}
        >
          <div className="stack">
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className={`chip ${filter === "all" ? "is-active" : ""}`} onClick={() => setFilter("all")}>Все · {assets.length}</button>
              <button type="button" className={`chip ${filter === "none" ? "is-active" : ""}`} onClick={() => setFilter("none")}>
                Без категории · {assets.filter((a) => a.categoryId == null).length}
              </button>
              {cats.map((c) => (
                <span key={c.id} className="row" style={{ gap: 2 }}>
                  <button type="button" className={`chip ${filter === c.id ? "is-active" : ""}`} onClick={() => setFilter(c.id)}>{c.name} · {c.count}</button>
                  {filter === c.id && (
                    <>
                      <Button size="sm" iconOnly icon={Pencil} title="Переименовать" onClick={() => setCatDialog({ id: c.id, name: c.name })} />
                      <Button size="sm" iconOnly icon={Trash2} title="Удалить категорию" onClick={() => removeCategory(c)} />
                    </>
                  )}
                </span>
              ))}
            </div>
            {shown.length === 0 ? (
              <EmptyState icon={Megaphone} title="Материалов нет" text="Добавьте свои рекламные видео, изображения или логотипы кнопками вверху." />
            ) : (
              <div className="media-grid">
                {shown.map((a) => <AssetTile key={a.id} a={a} selected={a.id === selId} onSelect={() => setSelId(a.id)} />)}
              </div>
            )}
          </div>
        </Card>

        <Card title={sel ? "Материал" : "Просмотр"}>
          {!sel ? (
            <div className="muted small">Выберите материал, чтобы посмотреть, переименовать или добавить его на Timeline.</div>
          ) : (
            <div className="stack">
              <div className="viewer" style={{ aspectRatio: "16/9" }}>
                {!sel.exists ? (
                  <EmptyState icon={X} title="Файл не найден" text={sel.path} />
                ) : sel.kind === "video" ? (
                  <video key={sel.path} src={fileUrl(sel.path)} controls />
                ) : (
                  <img src={fileUrl(sel.path)} alt="" />
                )}
              </div>
              <Field label="Название">
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => editName.trim() && editName !== sel.name && updateSel({ name: editName })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              </Field>
              <div className="grid grid-2">
                <Field label="Категория">
                  <select className="select" value={sel.categoryId ?? ""} onChange={(e) => updateSel({ categoryId: e.target.value ? +e.target.value : null })}>
                    <option value="">Без категории</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Тип">
                  <select className="select" value={sel.kind} disabled={sel.kind === "video"} onChange={(e) => updateSel({ kind: e.target.value as AdAsset["kind"] })}>
                    {sel.kind === "video" ? <option value="video">Видео</option> : (
                      <>
                        <option value="image">Изображение</option>
                        <option value="logo">Логотип</option>
                      </>
                    )}
                  </select>
                </Field>
              </div>
              <div className="small muted truncate" title={sel.path}>{sel.path}</div>
              <hr className="divider" />
              <Field label="Добавить в открытый проект" hint={sel.kind === "video" ? "Ролик вставляется в монтаж, остальное сдвигается" : `Наложение на ${data?.adRules.overlayDuration ?? 5} с`}>
                <div className="input-group">
                  <TimeInput value={at} max={total || undefined} onChange={setAt} />
                  <Button variant="primary" icon={Plus} onClick={addSelected} disabled={!sel.exists}>На Timeline</Button>
                </div>
              </Field>
              {data && Math.abs(safeAt - at) > 0.01 && (
                <div className="small muted">
                  {insideSpeech(data, at) ? "Точка внутри фразы — " : "Ближайшая склейка или пауза — "}
                  вставка будет в {formatTime(safeAt)}.
                </div>
              )}
              <Button size="sm" icon={Trash2} onClick={removeSel}>Убрать из библиотеки</Button>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Автоматическая расстановка"
        subtitle={project ? `Проект «${project.name}» · рекламных вставок: ${adsInProject}` : "Откройте проект"}
        actions={project && adsInProject > 0 ? <Button size="sm" icon={Trash2} onClick={removeAllAds}>Убрать всю рекламу</Button> : undefined}
      >
        {!project || !data || !rules ? (
          <EmptyState icon={Sparkles} title="Проект не открыт" text="Правила расстановки сохраняются в проекте." action={<Button onClick={() => navigate("projects")}>Мои проекты</Button>} />
        ) : (
          <div className="stack">
            <Notice>
              Реклама ставится только на склейках и в паузах речи и никогда — посреди фразы (учитываются тайминги субтитров).
              Для точного учёта речи сначала создайте субтитры. После применения всё можно поправить вручную на Timeline.
            </Notice>
            <Field label="Материалы для расстановки (по очереди)">
              <div className="row" style={{ gap: 6 }}>
                {assets.filter((a) => a.exists).map((a) => {
                  const on = rules.assetIds.includes(a.id);
                  return (
                    <button key={a.id} type="button" className={`chip ${on ? "is-active" : ""}`} onClick={() => setRules({ assetIds: on ? rules.assetIds.filter((x) => x !== a.id) : [...rules.assetIds, a.id] })}>
                      {KIND_LABEL[a.kind]}: {a.name}
                    </button>
                  );
                })}
                {!assets.length && <span className="small muted">Сначала добавьте материалы в библиотеку.</span>}
              </div>
            </Field>
            <div className="grid grid-4">
              <Field label="Где ставить">
                <Segmented<AdRules["where"]> value={rules.where} onChange={(v) => setRules({ where: v })} options={[{ value: "cuts", label: "Склейки" }, { value: "pauses", label: "Паузы" }, { value: "both", label: "Оба" }]} />
              </Field>
              <Field label="Максимум вставок">
                <input className="input" type="number" min={1} max={50} value={rules.maxCount} onChange={(e) => setRules({ maxCount: Math.max(1, +e.target.value || 1) }, "r-max")} />
              </Field>
              <Field label="Мин. интервал, с">
                <input className="input" type="number" min={1} value={rules.minGap} onChange={(e) => setRules({ minGap: Math.max(1, +e.target.value || 1) }, "r-gap")} />
              </Field>
              <Field label="Наложение, с">
                <input className="input" type="number" min={1} max={60} value={rules.overlayDuration} onChange={(e) => setRules({ overlayDuration: Math.max(1, +e.target.value || 1) }, "r-ov")} />
              </Field>
              <Field label="Не ставить первые, с">
                <input className="input" type="number" min={0} value={rules.skipStart} onChange={(e) => setRules({ skipStart: Math.max(0, +e.target.value || 0) }, "r-ss")} />
              </Field>
              <Field label="Не ставить последние, с">
                <input className="input" type="number" min={0} value={rules.skipEnd} onChange={(e) => setRules({ skipEnd: Math.max(0, +e.target.value || 0) }, "r-se")} />
              </Field>
              <Field label="Мин. пауза, с">
                <input className="input" type="number" min={0.2} step={0.05} value={rules.minPause} onChange={(e) => setRules({ minPause: Math.max(0.2, +e.target.value || 0.2) }, "r-mp")} />
              </Field>
              <Field label="Порог тишины, дБ">
                <input className="input" type="number" min={-70} max={-10} value={rules.noiseDb} onChange={(e) => setRules({ noiseDb: Math.min(-10, Math.max(-70, +e.target.value || -32)) }, "r-db")} />
              </Field>
            </div>
            {job.running ? (
              <div className="row">
                <div style={{ flex: 1 }}><ProgressBar value={job.progress} label={job.message} /></div>
                <Button size="sm" icon={X} onClick={job.cancel}>Отмена</Button>
              </div>
            ) : (
              <div>
                <Button variant="primary" icon={Wand2} onClick={buildPlan} disabled={!ruleAssets.length || !data.clips.length}>Подобрать точки</Button>
              </div>
            )}
            <ErrorNotice error={job.error} onClose={job.clearError} />
            {plan && (
              <div className="stack">
                {plan.length === 0 ? (
                  <Notice>Подходящих точек не найдено. Уменьшите интервал или минимальную паузу, либо выберите «Оба».</Notice>
                ) : (
                  <table className="table">
                    <thead><tr><th>Время</th><th>Тип точки</th><th>Материал</th><th /></tr></thead>
                    <tbody>
                      {plan.map((p, i) => (
                        <tr key={i}>
                          <td style={{ width: 150 }}>
                            <TimeInput value={p.at} max={total} onChange={(v) => setPlan(plan.map((x, j) => (j === i ? { ...x, at: nearestSafePoint(data, v, silences) } : x)))} />
                          </td>
                          <td>{p.source === "cut" ? "Склейка" : "Пауза в речи"}</td>
                          <td>
                            <select className="select" value={p.assetId} onChange={(e) => setPlan(plan.map((x, j) => (j === i ? { ...x, assetId: +e.target.value } : x)))}>
                              {ruleAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Button size="sm" iconOnly icon={Trash2} onClick={() => setPlan(plan.filter((_, j) => j !== i))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="row">
                  <Button variant="primary" onClick={applyCurrentPlan} disabled={!plan.length}>Применить к проекту</Button>
                  <Button onClick={() => setPlan(null)}>Отменить</Button>
                  {plan.length > 0 && <Button onClick={() => navigate("editor")}>Открыть редактор</Button>}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {catDialog && (
        <Modal
          title={catDialog.id == null ? "Новая категория" : "Переименовать категорию"}
          onClose={() => setCatDialog(null)}
          width={420}
          footer={<><Button onClick={() => setCatDialog(null)}>Отмена</Button><Button variant="primary" onClick={saveCategory}>Сохранить</Button></>}
        >
          <Field label="Название">
            <input className="input" autoFocus value={catDialog.name} onChange={(e) => setCatDialog({ ...catDialog, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveCategory()} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
