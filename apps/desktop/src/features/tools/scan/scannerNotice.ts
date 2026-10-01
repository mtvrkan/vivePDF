import type { ScannerDevice } from "@/types";

export type ScannerNotice = "loading" | "unsupported" | "saneMissing" | "deviceError" | "none" | null;
export type ScannerUnsupportedReason = "saneMissing" | "deviceError" | null;

export function scannerNotice(devices: ScannerDevice[] | null, supported: boolean, reason: ScannerUnsupportedReason = null): ScannerNotice {
  if (devices === null) return "loading";
  if (!supported) return reason === "saneMissing" ? "saneMissing" : "unsupported";
  if (devices.length === 0) return reason === "deviceError" ? "deviceError" : "none";
  return null;
}
