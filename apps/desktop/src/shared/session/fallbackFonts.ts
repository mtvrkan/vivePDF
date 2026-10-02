import { listen } from "@tauri-apps/api/event";
import { toRpcError } from "@/shared/rpc/client";
import { fallbackFontsDownload } from "@/shared/rpc/fallbackFonts";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";

export const FALLBACK_FONT_MISSING_EVENT = "fallback-font-missing";

export function noteMissingFont(fontSet: string) {
  const activeId = useDocumentStore.getState().activeId;
  if (activeId) useFallbackFontsStore.getState().noteMissing(activeId, fontSet);
}

export function listenForMissingFonts(): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  listen<string>(FALLBACK_FONT_MISSING_EVENT, (event) => noteMissingFont(event.payload))
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export async function downloadFontSet(fontSet: string, signal?: AbortSignal): Promise<boolean> {
  const store = useFallbackFontsStore.getState();
  if (store.downloads[fontSet]?.state === "downloading") return false;
  store.setDownload(fontSet, { state: "downloading", progress: null });
  try {
    await fallbackFontsDownload(fontSet, {
      signal,
      onProgress: (progress) => useFallbackFontsStore.getState().setDownload(fontSet, { state: "downloading", progress }),
    });
    useFallbackFontsStore.getState().setDownload(fontSet, { state: "installed" });
    return true;
  } catch (caught) {
    const error = toRpcError(caught);
    useFallbackFontsStore.getState().setDownload(fontSet, error.code === "CANCELLED" ? null : { state: "failed", error });
    return false;
  }
}
