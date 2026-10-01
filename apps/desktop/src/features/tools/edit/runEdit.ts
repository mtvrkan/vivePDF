import type { RpcCallOptions } from "@/shared/rpc/client";
import {
  cropPages,
  flattenPdf,
  headerFooter,
  removeHeaderFooter,
  imposePages,
  numberPages,
  redactPdf,
  repairPdf,
  replaceTextSpans,
  resizePages,
  setBookmarks,
  applyLetterhead,
  findReplaceText,
  autoLinkPdf,
  posterPages,
} from "@/shared/rpc/operations";
import { repairOutcome } from "@/features/tools/edit/repairReport";
import type { RepairResult } from "@/types";
import type { EditOutcome, EditRun } from "./editShared";

export async function runEdit(run: EditRun, options: RpcCallOptions): Promise<EditOutcome> {
  const params = { ...run.params, overwrite: run.overwrite ?? run.params.overwrite } as never;
  switch (run.tab) {
    case "number": {
      const result = await numberPages(params, options);
      return { ...result, extra: result.stamped };
    }
    case "headerFooter": {
      if (run.variant !== "remove") {
        const result = await headerFooter(params, options);
        return { ...result, extra: result.stamped };
      }
      const result = await removeHeaderFooter(params, options);
      return { ...result, extra: result.removed, removedFurniture: true };
    }
    case "crop": {
      const result = await cropPages(params, options);
      return { ...result, extra: result.cropped };
    }
    case "resize":
      return resizePages(params, options);
    case "flatten":
      return flattenPdf(params, options);
    case "redact": {
      const result = await redactPdf(params, options);
      return { ...result, extra: result.redactions };
    }
    case "repair": {
      const result = await repairPdf(params, options);
      return { ...result, extra: result.droppedPages, repair: result };
    }
    case "letterhead": {
      const result = await applyLetterhead(params, options);
      return { ...result, extra: result.applied };
    }
    case "findReplace": {
      const result = await findReplaceText(params, options);
      return { ...result, extra: result.replaced };
    }
    case "impose":
      return imposePages(params, options);
    case "poster": {
      const result = await posterPages(params, options);
      return { ...result, extra: result.sheets };
    }
    case "autolink": {
      const result = await autoLinkPdf(params, options);
      return { ...result, extra: result.added };
    }
    case "bookmarks":
      return setBookmarks(params, options);
    case "textedit": {
      const result = await replaceTextSpans(params, options);
      return { ...result, extra: result.replaced };
    }
  }
}

export function repairCaption(result: RepairResult, t: (key: string, values?: Record<string, unknown>) => string): string {
  const outcome = repairOutcome(result);
  const main = t(outcome.key, outcome.count === undefined ? undefined : { count: outcome.count });
  const parts = [main];
  if (outcome.blank !== undefined) parts.push(t("tools.edit.repair.blank", { count: outcome.blank }));
  if (result.recoveredBy !== "mupdf") parts.push(t(`tools.edit.repair.recovered.${result.recoveredBy}`));
  return parts.join(" · ");
}
