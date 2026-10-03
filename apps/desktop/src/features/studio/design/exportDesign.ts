import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioRender } from "@/shared/rpc/operations";
import type { StudioExportFormat } from "@/types/studio";
import { designToRender } from "../model/render";
import { measureTexts } from "./measure";
import { useStudioStore } from "./studioStore";

export type ExportParams = { output: string; overwrite?: boolean; format: StudioExportFormat; dpi: number; language: string; title: string };

export async function exportDesign(params: ExportParams, options?: RpcCallOptions) {
  const design = useStudioStore.getState().design;
  if (!design) throw new Error("no design");
  const measured = await measureTexts(design.pages.flatMap((page) => page.elements), params.language);
  return studioRender(
    {
      pages: designToRender(design, measured),
      output: params.output,
      overwrite: params.overwrite,
      format: params.format,
      dpi: params.dpi,
      language: params.language,
      title: params.title,
      date: new Date().toLocaleDateString(params.language),
    },
    options,
  );
}
