import { call } from "./tauri";

export interface TtUser {
  openId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  isVerified: boolean | null;
  followers: number | null;
  following: number | null;
  likes: number | null;
  videos: number | null;
  grantedScopes: string[];
}

export interface TtVideo {
  id: string;
  title: string | null;
  description: string | null;
  createTime: number | null;
  cover: string | null;
  shareUrl: string | null;
  duration: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export interface TtCreatorInfo {
  nickname: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number | null;
}

export const ttIsConnected = () => call<boolean>("tt_is_connected");
export const ttConnect = () => call<TtUser>("tt_connect");
export const ttDisconnect = () => call<void>("tt_disconnect");
export const ttUser = () => call<TtUser>("tt_user");
export const ttVideos = (cursor?: number | null) =>
  call<{ videos: TtVideo[]; cursor: number | null; hasMore: boolean }>("tt_videos", { cursor: cursor ?? null });
export const ttCreatorInfo = () => call<TtCreatorInfo>("tt_creator_info");
export const ttPublish = (args: {
  jobId: string;
  path: string;
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
}) => call<string>("tt_publish", args);

export const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Все",
  MUTUAL_FOLLOW_FRIENDS: "Взаимные подписчики",
  FOLLOWER_OF_CREATOR: "Подписчики",
  SELF_ONLY: "Только я",
};
