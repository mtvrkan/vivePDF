import { rpc, type RpcCallOptions } from "./client";

export type TessdataLanguage = { code: string; name: string };
export type TessdataLanguagesResult = { directory: string; installed: string[]; available: TessdataLanguage[] };
export type TessdataDownloadResult = { code: string; path: string; bytes: number };
export type TessdataRemoveResult = { code: string; removed: boolean };

export const tessdataLanguages = (options?: RpcCallOptions) => rpc<TessdataLanguagesResult>("system.tessdata_languages", {}, options);
export const tessdataDownload = (code: string, options?: RpcCallOptions) => rpc<TessdataDownloadResult>("system.tessdata_download", { code }, options);
export const tessdataRemove = (code: string, options?: RpcCallOptions) => rpc<TessdataRemoveResult>("system.tessdata_remove", { code }, options);
