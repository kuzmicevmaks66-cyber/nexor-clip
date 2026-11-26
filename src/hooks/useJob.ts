import { useCallback, useEffect, useRef, useState } from "react";
import type { JobProgress } from "@/types";
import { errorText, newId, onEvent } from "@/services/tauri";
import { cancelJob } from "@/services/system";

export interface JobState {
  running: boolean;
  progress: number;
  message: string;
  error: string | null;
}

/** Запуск долгой задачи backend (FFmpeg/Whisper/загрузка) с прогрессом и отменой. */
export function useJob() {
  const [state, setState] = useState<JobState>({ running: false, progress: 0, message: "", error: null });
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    let alive = true;
    onEvent<JobProgress>("job-progress", (p) => {
      if (p.jobId !== jobRef.current) return;
      setState((s) => ({ ...s, progress: p.progress, message: p.message || s.message }));
    }).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  const run = useCallback(async <T,>(fn: (jobId: string) => Promise<T>, startMessage = "Запуск…"): Promise<T | null> => {
    const id = newId();
    jobRef.current = id;
    setState({ running: true, progress: 0, message: startMessage, error: null });
    try {
      const r = await fn(id);
      setState({ running: false, progress: 1, message: "Готово", error: null });
      return r;
    } catch (e) {
      setState({ running: false, progress: 0, message: "", error: errorText(e) });
      return null;
    } finally {
      jobRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (jobRef.current) cancelJob(jobRef.current).catch(() => {});
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, run, cancel, clearError };
}
