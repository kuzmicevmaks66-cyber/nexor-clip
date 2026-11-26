import { call } from "./tauri";

export interface YtVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  description: string;
  publishedAt: string | null;
  thumbnail: string | null;
  duration: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface YtChannel {
  id: string;
  title: string;
  description: string;
  thumbnail: string | null;
  customUrl: string | null;
  publishedAt: string | null;
  subscribers: number | null;
  views: number | null;
  videos: number | null;
  hiddenSubscribers: boolean;
}

export interface YtSearchResult {
  videos: YtVideo[];
  channels: YtChannel[];
  nextPageToken: string | null;
}

export interface AnalyticsReport {
  columns: string[];
  rows: (string | number)[][];
  unavailable: string[];
}

export const ytSearch = (query: string, kind: "video" | "channel", pageToken?: string | null, order?: string) =>
  call<YtSearchResult>("yt_search", { query, kind, pageToken: pageToken ?? null, order: order ?? null });
export const ytVideoDetails = (id: string) => call<YtVideo>("yt_video_details", { id });
export const ytChannelVideos = (channelId: string) => call<YtVideo[]>("yt_channel_videos", { channelId });
export const ytChannels = (ids: string[]) => call<YtChannel[]>("yt_channels", { ids });
export const ytConnect = () => call<YtChannel>("yt_connect");
export const ytDisconnect = () => call<void>("yt_disconnect");
export const ytIsConnected = () => call<boolean>("yt_is_connected");
export const ytMyChannel = () => call<YtChannel>("yt_my_channel");
export const ytMyVideos = (pageToken?: string | null) =>
  call<[YtVideo[], string | null]>("yt_my_videos", { pageToken: pageToken ?? null });
export const ytAnalytics = (startDate: string, endDate: string, videoId?: string | null) =>
  call<AnalyticsReport>("yt_analytics", { startDate, endDate, videoId: videoId ?? null });
export const ytVideoTotals = (videoId: string, publishedAt: string) =>
  call<Record<string, number | null>>("yt_video_totals", { videoId, publishedAt });
export const ytUpload = (args: {
  jobId: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  privacy: string;
  madeForKids: boolean;
}) => call<string>("yt_upload", args);

/** ISO 8601 (PT1H2M3S) → секунды. */
export function isoDuration(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

/** YouTube возвращает HTML-сущности в title/description сниппета поиска. */
export function decodeEntities(s: string): string {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}
