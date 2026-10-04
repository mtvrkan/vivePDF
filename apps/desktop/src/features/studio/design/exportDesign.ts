import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioRender } from "@/shared/rpc/operations";
import type { StudioDesign, StudioExportFormat, StudioSignOptions } from "@/types/studio";
import { designToRender } from "../model/render";
import { measureTexts } from "./measure";
import { projectAssets } from "./projectFile";
import { useStudioStore } from "./studioStore";

export type ExportParams = {
  output: string;
  overwrite?: boolean;
  format: StudioExportFormat;
  dpi: number;
  language: string;
  title: string;
  embed: boolean;
  dataPath?: string | null;
  sheet?: string | null;
  split?: boolean;
  outputDir?: string;
  pattern?: string;
  sign?: StudioSignOptions | null;
};

export async function exportDesign(params: ExportParams, options?: RpcCallOptions, source?: StudioDesign) {
  const design = source ?? useStudioStore.getState().design;
  if (!design) throw new Error("no design");
  const measured = await measureTexts(design.pages.flatMap((page) => page.elements), params.language);
  return studioRender(
    {
      pages: designToRender(design, measured),
      output: params.split ? "" : params.output,
      overwrite: params.overwrite,
      format: params.format,
      dpi: params.dpi,
      embed: params.embed && params.format === "pdf" ? { design, assets: projectAssets(design) } : null,
      language: params.language,
      title: params.title,
      date: new Date().toLocaleDateString(params.language),
      dataPath: params.dataPath ?? null,
      sheet: params.sheet ?? null,
      split: Boolean(params.split),
      outputDir: params.split ? params.outputDir : null,
      pattern: params.pattern,
      sign: params.format === "pdf" ? (params.sign ?? null) : null,
    },
    options,
  );
}
