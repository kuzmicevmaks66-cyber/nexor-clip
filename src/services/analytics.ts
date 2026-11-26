import { call, isDesktop } from "./tauri";

export interface Point {
  at: string;
  value: number;
}

export const metricHistory = (platform: string, entityId: string, metric: string, limit = 365) =>
  isDesktop() ? call<Point[]>("metric_history", { platform, entityId, metric, limit }) : Promise.resolve([]);
export const lastUpdated = (platform: string, entityId: string) =>
  call<string | null>("last_updated", { platform, entityId });
