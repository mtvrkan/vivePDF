import type { SignatureInfo } from "@/types";

export type SignatureVerdict = "broken" | "modified" | "untrusted" | "trustedWithChanges" | "trusted";
export type SignaturesStatus = "valid" | "invalid" | "attention";

export function signatureVerdict(signature: SignatureInfo): SignatureVerdict {
  if (!signature.intact || !signature.valid) return "broken";
  if (signature.revoked === true || signature.trustProblem === "revoked") return "broken";
  if (signature.modified) return "modified";
  if (!signature.trusted) return "untrusted";
  return signature.coverage === "ENTIRE_FILE" ? "trusted" : "trustedWithChanges";
}

export function signaturesStatus(signatures: SignatureInfo[]): SignaturesStatus {
  const verdicts = signatures.map(signatureVerdict);
  if (verdicts.some((verdict) => verdict === "broken" || verdict === "modified")) return "invalid";
  if (verdicts.every((verdict) => verdict === "trusted")) return "valid";
  return "attention";
}
