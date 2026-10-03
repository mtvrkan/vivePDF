import { useEffect } from "react";
import { create } from "zustand";
import { studioImageInfo, studioQr } from "@/shared/rpc/operations";
import type { StudioQrLevel, StudioQrModules } from "@/types/studio";

export const PREVIEW_SIDE = 1600;

export type ImagePreview = { url: string; width: number; height: number };
type Entry<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error" };

type AssetsState = { images: Record<string, Entry<ImagePreview>>; codes: Record<string, Entry<StudioQrModules>> };

export const useStudioAssetsStore = create<AssetsState>(() => ({ images: {}, codes: {} }));

const imageTasks = new Map<string, Promise<ImagePreview | null>>();
const codeTasks = new Map<string, Promise<StudioQrModules | null>>();

function toBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function loadImagePreview(path: string): Promise<ImagePreview | null> {
  let task = imageTasks.get(path);
  if (!task) {
    useStudioAssetsStore.setState((state) => ({ images: { ...state.images, [path]: { status: "loading" } } }));
    task = studioImageInfo({ path, maxSide: PREVIEW_SIDE })
      .then((info) => {
        const value = { url: toBlobUrl(info.base64, info.mime), width: info.width, height: info.height };
        useStudioAssetsStore.setState((state) => ({ images: { ...state.images, [path]: { status: "ready", value } } }));
        return value;
      })
      .catch(() => {
        imageTasks.delete(path);
        useStudioAssetsStore.setState((state) => ({ images: { ...state.images, [path]: { status: "error" } } }));
        return null;
      });
    imageTasks.set(path, task);
  }
  return task;
}

export function useImagePreview(path: string | null): Entry<ImagePreview> | null {
  const entry = useStudioAssetsStore((state) => (path ? state.images[path] : undefined));
  useEffect(() => {
    if (path && !entry) void loadImagePreview(path);
  }, [path, entry]);
  return entry ?? (path ? { status: "loading" } : null);
}

export function qrKey(value: string, level: StudioQrLevel): string {
  return `${level}|${value}`;
}

export function loadQr(value: string, level: StudioQrLevel): Promise<StudioQrModules | null> {
  const key = qrKey(value, level);
  let task = codeTasks.get(key);
  if (!task) {
    useStudioAssetsStore.setState((state) => ({ codes: { ...state.codes, [key]: { status: "loading" } } }));
    task = studioQr({ value, errorLevel: level })
      .then((modules) => {
        useStudioAssetsStore.setState((state) => ({ codes: { ...state.codes, [key]: { status: "ready", value: modules } } }));
        return modules;
      })
      .catch(() => {
        useStudioAssetsStore.setState((state) => ({ codes: { ...state.codes, [key]: { status: "error" } } }));
        return null;
      });
    codeTasks.set(key, task);
  }
  return task;
}

export function useQrModules(value: string, level: StudioQrLevel): Entry<StudioQrModules> {
  const key = qrKey(value, level);
  const entry = useStudioAssetsStore((state) => state.codes[key]);
  useEffect(() => {
    if (!entry && value) void loadQr(value, level);
  }, [entry, value, level]);
  return entry ?? { status: "loading" };
}

export function qrPath(modules: StudioQrModules, width: number, height: number): string {
  const side = Math.min(width, height);
  const unit = side / modules.size;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    let column = 0;
    while (column < modules.size) {
      if (modules.modules[row * modules.size + column] !== "1") {
        column += 1;
        continue;
      }
      const start = column;
      while (column < modules.size && modules.modules[row * modules.size + column] === "1") column += 1;
      const x0 = left + start * unit;
      const x1 = left + column * unit;
      const y0 = top + row * unit;
      const y1 = y0 + unit;
      parts.push(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`);
    }
  }
  return parts.join("");
}
