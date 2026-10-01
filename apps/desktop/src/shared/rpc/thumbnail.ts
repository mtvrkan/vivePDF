import { rpc, type RpcCallOptions } from "./client";

export type ThumbnailResult = { image: string; width: number; height: number; pageCount: number };
export type ThumbnailParams = { path: string; password?: string; page?: number; width?: number };

export const renderThumbnail = (params: ThumbnailParams, options?: RpcCallOptions) => rpc<ThumbnailResult>("info.thumbnail", params, options);

export function thumbnailDataUrl(result: ThumbnailResult): string {
  return `data:image/png;base64,${result.image}`;
}
