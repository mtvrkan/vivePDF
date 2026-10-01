import { PdfErrorCode } from "@embedpdf/models";

const MAX_DEPTH = 4;

function errorCodeOf(value: unknown, depth = 0): number | null {
  if (depth > MAX_DEPTH || typeof value !== "object" || value === null) return null;
  const candidate = value as { code?: unknown; reason?: unknown; error?: unknown };
  if (typeof candidate.code === "number") return candidate.code;
  return errorCodeOf(candidate.reason, depth + 1) ?? errorCodeOf(candidate.error, depth + 1);
}

export function isPdfPasswordError(value: unknown): boolean {
  return errorCodeOf(value) === PdfErrorCode.Password;
}
