import { useEffect, useRef, useState } from "react";
import type { ProjectData } from "@/types/project";
import { fileUrl } from "@/services/tauri";
import { SubtitleLayer } from "@/features/subtitles/SubtitleLayer";
import type { Playback } from "./usePlayback";
import { frameSize } from "./spec";

/** Кадр монтажа: соотношение сторон проекта, режим вписывания, наложения и субтитры. */
export function Stage({ data, pb, maxHeight = 520, showSubtitles = true, emptyText }: {
  data: ProjectData;
  pb: Playback;
  maxHeight?: number;
  showSubtitles?: boolean;
  emptyText?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const { width: fw, height: fh } = frameSize(data.aspectRatio, 1080);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(box.w / fw, box.h / fh);
  const w = Math.max(10, fw * scale);
  const h = Math.max(10, fh * scale);

  const clip = pb.currentClip;
  const isVideo = clip?.kind === "video";
  const objectFit = data.fit === "crop" ? "cover" : "contain";

  // Размытый фон для режима «blur» рисуем из текущего видео.
  useEffect(() => {
    if (data.fit !== "blur" || !isVideo) return;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now;
      const c = canvasRef.current;
      const v = pb.videoRef.current;
      if (!c || !v || v.readyState < 2) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const vw = v.videoWidth || 16;
      const vh = v.videoHeight || 9;
      const s = Math.max(c.width / vw, c.height / vh);
      ctx.drawImage(v, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data.fit, isVideo, pb.videoRef]);

  const overlays = data.overlays.filter((o) => pb.time >= o.start && pb.time < o.end);

  return (
    <div ref={boxRef} className="stage" style={{ height: maxHeight }}>
      <div className="frame" style={{ width: w, height: h }}>
        {data.fit === "blur" && isVideo && (
          <canvas ref={canvasRef} width={64} height={Math.round((64 * fh) / fw)} className="frame__bg" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        )}
        {data.fit === "blur" && clip?.kind === "image" && (
          <img src={fileUrl(clip.path)} alt="" className="frame__media frame__bg" />
        )}
        <video
          ref={pb.videoRef}
          playsInline
          preload="auto"
          style={{ objectFit, visibility: isVideo ? "visible" : "hidden" }}
        />
        {clip?.kind === "image" && (
          <img src={fileUrl(clip.path)} alt="" className="frame__media" style={{ objectFit }} />
        )}
        {overlays.map((o) => (
          <img
            key={o.id}
            src={fileUrl(o.path)}
            alt=""
            className="frame__overlay"
            style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.width * 100}%`, opacity: o.opacity }}
          />
        ))}
        {showSubtitles && data.subtitles.enabled && (
          <SubtitleLayer cues={data.subtitles.cues} style={data.subtitles.style} time={pb.time} frameHeight={h} />
        )}
        {data.clips.length === 0 && <div className="frame__empty">{emptyText ?? "Timeline пуст"}</div>}
      </div>
    </div>
  );
}
