import type { RpcCallOptions } from "@/shared/rpc/client";
import { decryptPdf, decryptWithCertificate, encryptPdf, encryptWithCertificate, removeWatermark, sanitizePdf, stampPdf, watermarkPdf } from "@/shared/rpc/operations";
import type { EncryptCertificateResult, EncryptResult, OutputResult, RemoveWatermarkResult, SanitizeResult, StampResult } from "@/types";

type SecurityRun =
  | { tab: "encrypt"; params: Parameters<typeof encryptPdf>[0] }
  | { tab: "decrypt"; params: Parameters<typeof decryptPdf>[0] }
  | { tab: "certificate"; params: Parameters<typeof encryptWithCertificate>[0] }
  | { tab: "decryptCertificate"; params: Parameters<typeof decryptWithCertificate>[0] }
  | { tab: "watermark"; params: Parameters<typeof watermarkPdf>[0] }
  | { tab: "stamp"; params: Parameters<typeof stampPdf>[0] }
  | { tab: "removeWatermark"; params: Parameters<typeof removeWatermark>[0] }
  | { tab: "privacy"; params: Parameters<typeof sanitizePdf>[0] };

type RunParams = SecurityRun & { overwrite?: boolean };
export type SecurityResult = OutputResult | EncryptResult | EncryptCertificateResult | RemoveWatermarkResult | SanitizeResult | StampResult;

export function runSecurity(input: RunParams, options: RpcCallOptions): Promise<SecurityResult> {
  const params = { ...input.params, overwrite: input.overwrite ?? input.params.overwrite };
  if (input.tab === "encrypt") return encryptPdf(params as Parameters<typeof encryptPdf>[0], options);
  if (input.tab === "certificate") return encryptWithCertificate(params as Parameters<typeof encryptWithCertificate>[0], options);
  if (input.tab === "decryptCertificate") return decryptWithCertificate(params as Parameters<typeof decryptWithCertificate>[0], options);
  if (input.tab === "decrypt") return decryptPdf(params as Parameters<typeof decryptPdf>[0], options);
  if (input.tab === "removeWatermark") return removeWatermark(params as Parameters<typeof removeWatermark>[0], options);
  if (input.tab === "privacy") return sanitizePdf(params as Parameters<typeof sanitizePdf>[0], options);
  if (input.tab === "stamp") return stampPdf(params as Parameters<typeof stampPdf>[0], options);
  return watermarkPdf(params as Parameters<typeof watermarkPdf>[0], options);
}
