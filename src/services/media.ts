import type { MediaInfo, RenderResult } from "@/types";
import type { RenderSpec } from "@/features/editor/spec";
import { call } from "./tauri";

export const importMedia = (kind: "video" | "audio" | "image" | "any", multiple = true) =>
  call<MediaInfo[]>("import_media", { kind, multiple });
export const probeMedia = (path: string) => call<MediaInfo>("probe_media", { path });
export const mediaThumbnail = (path: string, at: number) => call<string>("media_thumbnail", { path, at });

export const exportVideo = (args: {
  jobId: string;
  spec: RenderSpec;
  outputDir: string | null;
  fileName: string;
  crf: number;
  preset: string;
  audioBitrate: string;
  projectId: string | null;
}) => call<RenderResult>("export_video", args);

export const renderPreview = (jobId: string, spec: RenderSpec) => call<RenderResult>("render_preview", { jobId, spec });

export const detectSilences = (jobId: string, spec: RenderSpec, noiseDb: number, minDuration: number) =>
  call<[number, number][]>("detect_silences", { jobId, spec, noiseDb, minDuration });

export const transcribe = (jobId: string, spec: RenderSpec, language: string, translate = false) =>
  call<{ start: number; end: number; text: string }[]>("transcribe", { jobId, spec, language, translate });

export const exportSrt = (cues: { start: number; end: number; text: string }[], defaultName: string) =>
  call<string | null>("export_srt", { cues, defaultName });
export const importSrt = () => call<{ start: number; end: number; text: string }[] | null>("import_srt");
export const defaultExportDir = () => call<string>("default_export_dir_path");
