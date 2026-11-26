import { useEffect, useState } from "react";
import { mediaThumbnail } from "@/services/media";
import { fileUrl, isDesktop } from "@/services/tauri";

const cache = new Map<string, Promise<string | null>>();

/** Миниатюра медиафайла: для изображений — сам файл, для видео — кадр из кэша FFmpeg. */
export function useThumbnail(path: string | null | undefined, kind: string, at = 1): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || !isDesktop()) return setUrl(null);
    if (kind === "image" || kind === "logo") return setUrl(fileUrl(path));
    if (kind !== "video") return setUrl(null);
    const key = `${path}@${at.toFixed(1)}`;
    let p = cache.get(key);
    if (!p) {
      p = mediaThumbnail(path, at)
        .then((f) => fileUrl(f))
        .catch(() => null);
      cache.set(key, p);
    }
    let alive = true;
    p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path, kind, at]);
  return url;
}
