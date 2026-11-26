import { useEffect, useState } from "react";
import { Send, X } from "lucide-react";
import { Button, ErrorNotice, Field, Modal, Notice, ProgressBar, Segmented, Toggle } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { getSettings, openExternal } from "@/services/system";
import { ytIsConnected, ytUpload } from "@/services/youtube";
import { PRIVACY_LABELS, ttCreatorInfo, ttIsConnected, ttPublish, type TtCreatorInfo } from "@/services/tiktok";
import { errorText } from "@/services/tauri";

type Target = "youtube" | "tiktok";

/**
 * Публикация готового файла через официальные API. Выполняется только по явному
 * нажатию пользователя; ничего не публикуется автоматически.
 */
export function PublishDialog({ path, defaultTitle, onClose }: { path: string; defaultTitle: string; onClose: () => void }) {
  const job = useJob();
  const [target, setTarget] = useState<Target>("youtube");
  const [ytOk, setYtOk] = useState<boolean | null>(null);
  const [ttOk, setTtOk] = useState<boolean | null>(null);
  const [ttEnabled, setTtEnabled] = useState(false);
  const [creator, setCreator] = useState<TtCreatorInfo | null>(null);
  const [creatorErr, setCreatorErr] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState("private");
  const [kids, setKids] = useState(false);
  const [ttPrivacy, setTtPrivacy] = useState("");
  const [noComment, setNoComment] = useState(false);
  const [noDuet, setNoDuet] = useState(false);
  const [noStitch, setNoStitch] = useState(false);
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    ytIsConnected().then(setYtOk).catch(() => setYtOk(false));
    ttIsConnected().then(setTtOk).catch(() => setTtOk(false));
    getSettings()
      .then((s) => setTtEnabled(s.values.tiktok_publish_enabled === "1"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (target !== "tiktok" || !ttOk || !ttEnabled || creator) return;
    ttCreatorInfo()
      .then((c) => {
        setCreator(c);
        setNoComment(c.commentDisabled);
        setNoDuet(c.duetDisabled);
        setNoStitch(c.stitchDisabled);
      })
      .catch((e) => setCreatorErr(errorText(e)));
  }, [target, ttOk, ttEnabled, creator]);

  const publish = async () => {
    setDone(null);
    if (target === "youtube") {
      const id = await job.run((jobId) =>
        ytUpload({
          jobId,
          path,
          title,
          description,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          privacy,
          madeForKids: kids,
        }),
      );
      if (id) setDone(`https://youtu.be/${id}`);
    } else {
      const id = await job.run((jobId) =>
        ttPublish({ jobId, path, title, privacyLevel: ttPrivacy, disableComment: noComment, disableDuet: noDuet, disableStitch: noStitch }),
      );
      if (id) setDone("tiktok");
    }
  };

  const ytReady = ytOk && title.trim().length > 0;
  const ttReady = ttOk && ttEnabled && creator && ttPrivacy && consent;

  return (
    <Modal
      title="Публикация"
      onClose={job.running ? () => {} : onClose}
      width={620}
      footer={
        job.running ? (
          <Button icon={X} onClick={job.cancel}>Отменить</Button>
        ) : (
          <>
            <Button onClick={onClose}>{done ? "Готово" : "Закрыть"}</Button>
            {!done && (
              <Button variant="primary" icon={Send} disabled={target === "youtube" ? !ytReady : !ttReady} onClick={publish}>
                Опубликовать
              </Button>
            )}
          </>
        )
      }
    >
      <div className="small muted truncate" title={path}>Файл: {path}</div>
      <Segmented<Target>
        value={target}
        onChange={setTarget}
        options={[
          { value: "youtube", label: "YouTube" },
          { value: "tiktok", label: "TikTok" },
        ]}
      />

      {target === "youtube" && (
        <>
          {ytOk === false && <Notice>Канал YouTube не подключён. Подключите его в «Настройки → YouTube» (нужен доступ youtube.upload).</Notice>}
          <Field label="Название" hint={`${title.length}/100`}>
            <input className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Описание">
            <textarea className="textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Теги" hint="Через запятую">
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <div className="row">
            <Segmented
              value={privacy}
              onChange={setPrivacy}
              options={[
                { value: "private", label: "Приватное" },
                { value: "unlisted", label: "По ссылке" },
                { value: "public", label: "Открытое" },
              ]}
            />
            <Toggle checked={kids} onChange={setKids} label="Для детей" />
          </div>
          <div className="small muted">
            Видео, загруженные через API непроверенным проектом Google Cloud, YouTube может принудительно сделать приватными до прохождения аудита.
          </div>
        </>
      )}

      {target === "tiktok" && (
        <>
          {!ttEnabled && <Notice>Публикация в TikTok выключена. Включите её в «Настройки → TikTok» и переподключите аккаунт.</Notice>}
          {ttEnabled && ttOk === false && <Notice>TikTok не подключён.</Notice>}
          {creatorErr && <ErrorNotice error={creatorErr} />}
          {creator && (
            <>
              <div className="small">Аккаунт: <strong>{creator.nickname ?? "—"}</strong></div>
              <Field label="Подпись">
                <textarea className="textarea" rows={3} maxLength={2200} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Кто может смотреть" hint="Выбор обязателен — значения по умолчанию нет">
                <select className="select" value={ttPrivacy} onChange={(e) => setTtPrivacy(e.target.value)}>
                  <option value="">— выберите —</option>
                  {creator.privacyOptions.map((o) => (
                    <option key={o} value={o}>{PRIVACY_LABELS[o] ?? o}</option>
                  ))}
                </select>
              </Field>
              <div className="row">
                <Toggle checked={noComment} disabled={creator.commentDisabled} onChange={setNoComment} label="Запретить комментарии" />
                <Toggle checked={noDuet} disabled={creator.duetDisabled} onChange={setNoDuet} label="Запретить дуэты" />
                <Toggle checked={noStitch} disabled={creator.stitchDisabled} onChange={setNoStitch} label="Запретить Stitch" />
              </div>
              <Toggle
                checked={consent}
                onChange={setConsent}
                label={
                  <span>
                    Я соглашаюсь с{" "}
                    <button type="button" className="link" onClick={() => openExternal("https://www.tiktok.com/legal/page/global/music-usage-confirmation/en")}>
                      Music Usage Confirmation
                    </button>{" "}
                    TikTok
                  </span>
                }
              />
              <div className="small muted">После публикации обработка на стороне TikTok может занять несколько минут.</div>
            </>
          )}
        </>
      )}

      {(job.running || job.progress > 0) && !done && <ProgressBar value={job.progress} label={job.message} />}
      <ErrorNotice error={job.error} onClose={job.clearError} />
      {done && (
        <div className="notice">
          <Send size={16} />
          <div>
            {done === "tiktok" ? (
              "Видео отправлено в TikTok."
            ) : (
              <>
                Видео загружено:{" "}
                <button type="button" className="link" onClick={() => openExternal(done)}>{done}</button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
