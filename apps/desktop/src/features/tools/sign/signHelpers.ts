import type { TrustRoot, TrustSource } from "@/types";

export { signatureVerdict, type SignatureVerdict } from "@/shared/lib/signatureVerdict";

export const MIN_KEY_PASSWORD = 8;
export const MAX_NAME_BYTES = 64;
export const CERTIFICATE_REASONS = ["certificate", "certificatePassword", "keyFileFormat", "certificateLegacy"] as const;

export function nameTooLong(value: string): boolean {
  return new TextEncoder().encode(value.trim()).length > MAX_NAME_BYTES;
}

export function certificateReason(reason: unknown): (typeof CERTIFICATE_REASONS)[number] | null {
  return CERTIFICATE_REASONS.find((item) => item === reason) ?? null;
}

export function insecureTimestamp(url: string): boolean {
  return /^http:\/\//i.test(url.trim());
}

export function stampTextForInput(stampText: string): string {
  return stampText.replaceAll("\n", " | ");
}

export function stampTextFromInput(value: string): string {
  return value.replaceAll(" | ", "\n");
}

export function sharedTrustFiles(roots: TrustRoot[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const root of roots) {
    if (seen.has(root.id)) shared.add(root.id);
    seen.add(root.id);
  }
  return shared;
}

export function trustSourceName(source: TrustSource): string | null {
  if (source.name && source.territory) return `${source.name} (${source.territory})`;
  return source.name ?? source.territory;
}

export function shortFingerprint(fingerprint: string): string {
  return `${(fingerprint.slice(0, 16).match(/.{1,4}/g) ?? []).join(" ")}…`;
}
