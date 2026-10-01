import { readDocumentBytes } from "@/shared/rpc/files";
import { prepareView, restoreView } from "@/shared/rpc/operations";
import { rangeSource, readOriginalSource, type ViewableSource } from "@/shared/session/viewSources";
import type { LayerChoice, ViewPrepareResult } from "@/types";

export const PREPARE_VIEW_TIMEOUT_MS = 1500;
export const LAYER_VIEW_TIMEOUT_MS = 60000;

const displayFontSources = new Set<string>();
const layerViewSources = new Set<string>();

export function usesDisplayFonts(path: string): boolean {
  return displayFontSources.has(path);
}

export function usesLayerView(path: string): boolean {
  return layerViewSources.has(path);
}

async function preparedView(path: string, password?: string, layers: LayerChoice[] = []): Promise<ViewPrepareResult | null> {
  const source = password ? { path, password } : { path };
  const timeout = layers.length > 0 ? LAYER_VIEW_TIMEOUT_MS : PREPARE_VIEW_TIMEOUT_MS;
  return prepareView(layers.length > 0 ? { ...source, layers } : source, { signal: AbortSignal.timeout(timeout) }).then(
    (result) => result,
    () => null,
  );
}

function noteView(path: string, prepared: ViewPrepareResult | null, used: boolean) {
  if (used && prepared && prepared.fonts > 0) displayFontSources.add(path);
  else displayFontSources.delete(path);
  if (used && prepared && (prepared.layers ?? 0) > 0) layerViewSources.add(path);
  else layerViewSources.delete(path);
}

export async function preparedViewSource(path: string, password?: string, layers: LayerChoice[] = []): Promise<ViewableSource | null> {
  const prepared = await preparedView(path, password, layers);
  const viewPath = prepared?.viewPath;
  const source = viewPath
    ? await rangeSource(viewPath).then((range) =>
        range ?? readDocumentBytes(viewPath).then((buffer): ViewableSource => ({ kind: "buffer", buffer }), () => null),
      )
    : null;
  noteView(path, prepared, source !== null);
  return source;
}

export async function readViewableSource(path: string): Promise<ViewableSource> {
  return (await preparedViewSource(path)) ?? (await readOriginalSource(path));
}

export async function restoreSavedView(sourcePath: string, savedPath: string, password?: string): Promise<void> {
  if (!usesDisplayFonts(sourcePath) && !usesLayerView(sourcePath)) return;
  await restoreView(password ? { path: savedPath, password } : { path: savedPath });
}
