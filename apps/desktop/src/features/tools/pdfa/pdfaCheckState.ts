import type { PdfaCheck } from "@/types";

export type PdfaCheckState = "pass" | "fixable" | "blocking";

export function pdfaCheckState(check: Pick<PdfaCheck, "status" | "fixable">): PdfaCheckState {
  if (check.status === "pass") return "pass";
  return check.fixable ? "fixable" : "blocking";
}
