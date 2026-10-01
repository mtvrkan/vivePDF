import type { FillResult, FormDataExportResult, FormDataImportResult, FormDetectResult, FormExportResult, FormMergeResult, OutputResult } from "@/types";

export type FormsResult = FillResult | FormMergeResult | FormExportResult | FormDetectResult | OutputResult | FormDataImportResult | FormDataExportResult;

type Translate = (key: string, options?: Record<string, unknown>) => string;

function withCalculation(caption: string, result: { recalculated?: number; calcSkipped?: number }, t: Translate): string {
  const recalculated = result.recalculated ?? 0;
  const skipped = result.calcSkipped ?? 0;
  if (recalculated === 0 && skipped === 0) return caption;
  return `${caption} · ${t("tools.forms.recalculated", { count: recalculated, skipped })}`;
}

function withFailures(caption: string, failed: number, t: Translate): string {
  return failed > 0 ? `${caption} · ${t("tools.forms.merge.failedCaption", { count: failed })}` : caption;
}

function withFillNotes(caption: string, result: FillResult, t: Translate): string {
  const notes = [caption];
  if (result.truncated?.length) notes.push(t("tools.forms.truncated", { count: result.truncated.length, names: result.truncated.join(", ") }));
  if (result.missingGlyphs?.length) notes.push(t("tools.forms.missingGlyphs", { characters: result.missingGlyphs.join(" ") }));
  if (result.xfaRemoved) notes.push(t("tools.forms.xfaRemoved"));
  if (result.signaturesKept) notes.push(t("tools.forms.signaturesKept"));
  return notes.join(" · ");
}

export function summarizeFormsResult(result: FormsResult, t: Translate): { count: number; caption: string; outputs: string[] } {
  if ("unmatched" in result) {
    return { count: result.filled, caption: withCalculation(t("tools.forms.data.importedCaption", { unmatched: result.unmatched.length }), result, t), outputs: [result.output] };
  }
  if ("filled" in result) return { count: result.filled, caption: withFillNotes(withCalculation(t("tools.forms.filledCaption"), result, t), result, t), outputs: [result.output] };
  if ("rows" in result) {
    return {
      count: result.outputs.length,
      caption: withFailures(withCalculation(t("tools.forms.merge.caption", { skipped: result.skipped, unmatched: result.unmatchedFields.length }), result, t), result.failed?.length ?? 0, t),
      outputs: result.outputs.map((item) => item.output),
    };
  }
  if ("files" in result) return { count: result.files, caption: t("tools.forms.export.caption", { failed: result.failed.length }), outputs: [result.output] };
  if ("fields" in result) {
    return Array.isArray(result.fields)
      ? { count: result.fields.length, caption: t("tools.forms.detect.caption"), outputs: [result.output] }
      : { count: result.fields, caption: t("tools.forms.data.exportedCaption"), outputs: [result.output] };
  }
  return { count: result.pageCount, caption: t("info.pages"), outputs: [result.output] };
}
