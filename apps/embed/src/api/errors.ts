import type { VivePdfAnnotateError } from "./types";

export function annotateError(code: VivePdfAnnotateError["code"], message: string): VivePdfAnnotateError {
  return Object.assign(new Error(`vive-pdf: ${message}`), { code });
}
