import { describe, expect, it } from "vitest";
import type { SignatureInfo } from "@/types";
import { signaturesStatus, signatureVerdict } from "./signatureVerdict";

function signature(overrides: Partial<SignatureInfo> = {}): SignatureInfo {
  return {
    fieldName: "Signature1",
    signer: "Ada Lovelace",
    signedAt: null,
    intact: true,
    valid: true,
    trusted: true,
    trustSource: "user",
    trustProblem: null,
    revoked: null,
    coverage: "ENTIRE_FILE",
    modificationLevel: null,
    reason: null,
    location: null,
    summary: "",
    modified: false,
    certified: false,
    permission: null,
    ...overrides,
  };
}

describe("signatureVerdict", () => {
  it("trusts an intact signature covering the whole file", () => {
    expect(signatureVerdict(signature())).toBe("trusted");
    expect(signatureVerdict(signature({ coverage: "ENTIRE_REVISION" }))).toBe("trustedWithChanges");
  });

  it("calls a broken, revoked or modified signature what it is", () => {
    expect(signatureVerdict(signature({ intact: false }))).toBe("broken");
    expect(signatureVerdict(signature({ revoked: true }))).toBe("broken");
    expect(signatureVerdict(signature({ modified: true }))).toBe("modified");
    expect(signatureVerdict(signature({ trusted: false }))).toBe("untrusted");
  });
});

describe("signaturesStatus", () => {
  it("is valid only when every signature is trusted", () => {
    expect(signaturesStatus([signature(), signature({ fieldName: "Signature2" })])).toBe("valid");
  });

  it("asks for attention when a signer is unknown or later changes were allowed", () => {
    expect(signaturesStatus([signature(), signature({ trusted: false })])).toBe("attention");
    expect(signaturesStatus([signature({ coverage: "ENTIRE_REVISION" })])).toBe("attention");
  });

  it("is invalid as soon as one signature is broken or the document was modified", () => {
    expect(signaturesStatus([signature({ trusted: false }), signature({ valid: false })])).toBe("invalid");
    expect(signaturesStatus([signature(), signature({ modified: true })])).toBe("invalid");
  });
});
