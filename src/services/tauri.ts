// Тонкая обёртка над Tauri IPC.
// Если UI открыт в обычном браузере (npm run dev без Tauri), команды недоступны —
// мы явно сообщаем об этом, а не подставляем выдуманные данные.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class DesktopOnlyError extends Error {
  constructor(command: string) {
    super(`Команда «${command}» доступна только в desktop-приложении (npm run app:dev).`);
    this.name = "DesktopOnlyError";
  }
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new DesktopOnlyError(command);
  return invoke<T>(command, args);
}

/** URL локального файла для <video>/<img> через asset-протокол Tauri. */
export function fileUrl(path: string): string {
  return isDesktop() ? convertFileSrc(path) : "";
}

export async function onEvent<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return listen<T>(event, (e) => cb(e.payload));
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
