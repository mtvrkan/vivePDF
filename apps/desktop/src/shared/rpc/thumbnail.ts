import { rpc, type RpcCallOptions } from "./client";

export type ThumbnailFormat = "png" | "jpeg";
export type ThumbnailResult = { image: string; width: number; height: number; pageCount: number; format?: ThumbnailFormat; stamp?: string };
export type ThumbnailParams = { path: string; password?: string; page?: number; width?: number; format?: ThumbnailFormat };

export const renderThumbnail = (params: ThumbnailParams, options?: RpcCallOptions) => rpc<ThumbnailResult>("info.thumbnail", params, options);

export function thumbnailDataUrl(result: ThumbnailResult): string {
  return `data:image/${result.format ?? "png"};base64,${result.image}`;
}
