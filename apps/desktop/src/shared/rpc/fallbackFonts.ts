import { rpc, type RpcCallOptions } from "./client";

export type FallbackFontSetInfo = { id: string; bytes: number; installed: boolean };
export type FallbackFontsResult = { directory: string; sets: FallbackFontSetInfo[] };
export type FallbackFontsDownloadResult = { set: string; bytes: number };
export type FallbackFontsRemoveResult = { set: string; removed: boolean };

export const fallbackFonts = (options?: RpcCallOptions) => rpc<FallbackFontsResult>("system.fallback_fonts", {}, options);
export const fallbackFontsDownload = (set: string, options?: RpcCallOptions) =>
  rpc<FallbackFontsDownloadResult>("system.fallback_fonts_download", { set }, options);
export const fallbackFontsRemove = (set: string, options?: RpcCallOptions) => rpc<FallbackFontsRemoveResult>("system.fallback_fonts_remove", { set }, options);
