import type { RpcCallOptions } from "@/shared/rpc/client";
import { studioRender } from "@/shared/rpc/operations";
import type { StudioDesign, StudioExportFormat, StudioSignOptions } from "@/types/studio";
import { designToRender } from "../model/render";
import { isEveryPage } from "./exportPages";
import { measureTexts } from "./measure";
import { projectAssets } from "./projectFile";
import { useStudioStore } from "./studioStore";

export type ExportParams = {
  output: string;
  overwrite?: boolean;
  format: StudioExportFormat;
  dpi: number;
  quality?: number;
  transparent?: boolean;
  pages?: number[] | null;
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

export function chosenDesign(design: StudioDesign, pages: number[] | null | undefined): { design: StudioDesign; numbers: number[] | null } {
  const numbers = (pages ?? []).filter((page) => Number.isInteger(page) && page >= 1 && page <= design.pages.length);
  if (!numbers.length || isEveryPage(numbers, design.pages.length)) return { design, numbers: null };
  return { design: { ...design, pages: numbers.map((page) => design.pages[page - 1]) }, numbers };
}

export async function exportDesign(params: ExportParams, options?: RpcCallOptions, source?: StudioDesign) {
  const whole = source ?? useStudioStore.getState().design;
  if (!whole) throw new Error("no design");
  const { design, numbers } = chosenDesign(whole, params.pages);
  const picture = params.format !== "pdf";
  const transparent = params.format === "png" && Boolean(params.transparent);
  const measured = await measureTexts(design.pages.flatMap((page) => page.elements), params.language);
  return studioRender(
    {
      pages: designToRender(design, measured, { keepWhite: transparent }),
      output: params.split ? "" : params.output,
      overwrite: params.overwrite,
      format: params.format,
      dpi: params.dpi,
      quality: params.quality,
      transparent,
      pageNumbers: picture ? numbers : null,
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
