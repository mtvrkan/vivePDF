import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { defaultOutputDirectory, dirnameOf, joinPath, stemOf } from "@/shared/lib/paths";
import { sanitizeFileName } from "@/shared/lib/naming";
import type { RpcError } from "@/types";
import { studioOpenProject, studioSaveProject } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import { STUDIO_DOCUMENT_EXTENSION, STUDIO_PROJECT_EXTENSION, type StudioDesign } from "@/types/studio";
import { normalizeDesign } from "../model/design";
import { imagePaths, pageToRender } from "../model/render";
import { measureTexts } from "./measure";
import { useRecentDesignsStore } from "./recentDesigns";
import { useStudioStore } from "./studioStore";

export type LoadedDesign = { design: StudioDesign; filePath: string | null; thumbnail: string };

export function thumbnailUrl(base64: string): string {
  return base64 ? `data:image/jpeg;base64,${base64}` : "";
}

export function projectAssets(design: StudioDesign): string[] {
  return imagePaths(design).filter((path) => path.length > 0);
}

function remember(design: StudioDesign, path: string, thumbnail: string) {
  const first = design.pages[0];
  useRecentDesignsStore.getState().add({ path, name: design.name || stemOf(path), savedAt: Date.now(), width: first.width, height: first.height, thumbnail });
}

export async function loadDesign(path: string, password: string | null = null): Promise<LoadedDesign> {
  const result = await studioOpenProject({ path, password });
  const design = normalizeDesign(result.design);
  if (!design) {
    const error: RpcError = { code: "INVALID_PARAMS", message: "not a design", data: { reason: "notProject" } };
    throw error;
  }
  const thumbnail = thumbnailUrl(result.thumbnail);
  if (result.source === "project") {
    remember(design, path, thumbnail);
    return { design, filePath: path, thumbnail };
  }
  return { design, filePath: null, thumbnail };
}

export async function pickDesignFile(filterName: string): Promise<string | null> {
  const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: filterName, extensions: [STUDIO_PROJECT_EXTENSION, STUDIO_DOCUMENT_EXTENSION, "pdf"] }] });
  return typeof selected === "string" ? selected : null;
}

async function chooseTarget(design: StudioDesign, current: string | null, fallbackName: string, filterName: string): Promise<string | null> {
  const name = `${sanitizeFileName(design.name.trim()) || fallbackName}.${STUDIO_PROJECT_EXTENSION}`;
  const directory = current ? dirnameOf(current) : await defaultOutputDirectory();
  const chosen = await saveDialog({ defaultPath: joinPath(directory, name), filters: [{ name: filterName, extensions: [STUDIO_PROJECT_EXTENSION] }] });
  return chosen ?? null;
}

export async function saveDesign(options: { saveAs: boolean; fallbackName: string; filterName: string }): Promise<string | null> {
  const state = useStudioStore.getState();
  const design = state.design;
  if (!design) return null;
  const target = !options.saveAs && state.filePath ? state.filePath : await chooseTarget(design, state.filePath, options.fallbackName, options.filterName);
  if (!target) return null;
  const language = useUiStore.getState().locale;
  const first = design.pages[0];
  const measured = await measureTexts(first.elements, language);
  const result = await studioSaveProject({ design, assets: projectAssets(design), preview: pageToRender(first, measured), language, output: target, overwrite: true });
  if (useStudioStore.getState().design === design) useStudioStore.getState().markSaved(result.output);
  else useStudioStore.setState({ filePath: result.output });
  remember(design, result.output, thumbnailUrl(result.thumbnail));
  return result.output;
}
