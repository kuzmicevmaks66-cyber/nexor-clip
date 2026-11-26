import { call } from "./tauri";

export interface AdCategory {
  id: number;
  name: string;
  count: number;
}

export interface AdAsset {
  id: number;
  name: string;
  kind: "video" | "image" | "logo";
  path: string;
  categoryId: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  size: number;
  createdAt: string;
  exists: boolean;
}

export const adListCategories = () => call<AdCategory[]>("ad_list_categories");
export const adCreateCategory = (name: string) => call<number>("ad_create_category", { name });
export const adRenameCategory = (id: number, name: string) => call<void>("ad_rename_category", { id, name });
export const adDeleteCategory = (id: number) => call<void>("ad_delete_category", { id });
export const adListAssets = () => call<AdAsset[]>("ad_list_assets");
export const adImport = (kind: AdAsset["kind"], categoryId: number | null) =>
  call<number>("ad_import", { kind, categoryId });
export const adUpdateAsset = (id: number, name: string, categoryId: number | null, kind: AdAsset["kind"]) =>
  call<void>("ad_update_asset", { id, name, categoryId, kind });
export const adDeleteAsset = (id: number) => call<void>("ad_delete_asset", { id });
