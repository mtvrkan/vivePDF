import type { PdfaCheck, PdfaLevel, PdfaReport } from "@/types";
import { pdfaCheckState, type PdfaCheckState } from "./pdfaCheckState";

export type PdfaComparisonRow = { id: PdfaCheck["id"]; before: PdfaCheckState; after: "pass" | "fail" };

const ICC_VERSION = "iccVersion";

function failVariant(item: PdfaCheck, level: PdfaLevel): string {
  const fixable = pdfaCheckState(item) === "fixable";
  if (item.id === "metadata" && item.value) return "other";
  if (item.id === "attachments" && level.startsWith("3")) return "link";
  if (item.id === "layers" && level.startsWith("1")) return fixable ? "merge" : "hidden";
  if (item.id === "transparency" && fixable) return "groups";
  if (item.id === "outputIntent" && item.value === ICC_VERSION) return fixable ? "iccVersion" : "iccVersionCmyk";
  return "fail";
}

export function pdfaDetailKey(item: PdfaCheck, level: PdfaLevel): string {
  const variant = item.status === "pass" ? (item.id === "attachments" && level.startsWith("3") ? "passLinked" : "pass") : failVariant(item, level);
  return `tools.pdfa.checks.${item.id}.${variant}`;
}

export function pdfaComparison(before: PdfaReport, after: PdfaReport): PdfaComparisonRow[] {
  const afterStatus = new Map(after.checks.map((item) => [item.id, item.status]));
  const rows: PdfaComparisonRow[] = before.checks
    .filter((item) => item.status === "fail" || afterStatus.get(item.id) === "fail")
    .map((item) => ({ id: item.id, before: pdfaCheckState(item), after: afterStatus.get(item.id) ?? "pass" }));
  const listed = new Set(before.checks.map((item) => item.id));
  for (const item of after.checks) {
    if (!listed.has(item.id) && item.status === "fail") rows.push({ id: item.id, before: "pass", after: "fail" });
  }
  return rows;
}
