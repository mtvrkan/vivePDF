import { describe, expect, it } from "vitest";
import type { SignatureInfo, TrustRoot } from "@/types";
import { certificateReason, insecureTimestamp, nameTooLong, sharedTrustFiles, shortFingerprint, signatureVerdict, stampTextForInput, stampTextFromInput, trustSourceName } from "./signHelpers";

const base: SignatureInfo = {
  fieldName: "Sig",
  signer: "Ayşe",
  signedAt: null,
  intact: true,
  valid: true,
  trusted: false,
  trustSource: "none",
  revoked: null,
  coverage: "ENTIRE_FILE",
  modificationLevel: null,
  reason: null,
  location: null,
  summary: "",
  modified: false,
  certified: false,
  permission: null,
};

describe("signatureVerdict", () => {
  it("treats an intact but later modified signature as a problem", () => {
    expect(signatureVerdict({ ...base, modified: true, trusted: true })).toBe("modified");
  });

  it("reports broken before anything else", () => {
    expect(signatureVerdict({ ...base, intact: false, modified: true })).toBe("broken");
  });

  it("separates trusted from untrusted intact signatures", () => {
    expect(signatureVerdict(base)).toBe("untrusted");
    expect(signatureVerdict({ ...base, trusted: true })).toBe("trusted");
  });

  it("treats a withdrawn certificate as broken even when the chain is trusted", () => {
    expect(signatureVerdict({ ...base, trusted: true, revoked: true })).toBe("broken");
  });

  it("treats a revocation reason as broken when the online check was off", () => {
    expect(signatureVerdict({ ...base, revoked: null, trustProblem: "revoked" })).toBe("broken");
  });

  it("flags a trusted signature when content was added after signing", () => {
    expect(signatureVerdict({ ...base, trusted: true, coverage: "ENTIRE_REVISION" })).toBe("trustedWithChanges");
    expect(signatureVerdict({ ...base, trusted: true, coverage: "UNKNOWN" })).toBe("trustedWithChanges");
  });

  it("keeps an untrusted signature untrusted whatever it covers", () => {
    expect(signatureVerdict({ ...base, trustProblem: "expired", coverage: "ENTIRE_REVISION" })).toBe("untrusted");
  });
});

describe("certificate name limit", () => {
  it("counts bytes the way a certificate stores them", () => {
    expect(nameTooLong("a".repeat(64))).toBe(false);
    expect(nameTooLong("a".repeat(65))).toBe(true);
    expect(nameTooLong("ş".repeat(32))).toBe(false);
    expect(nameTooLong("ş".repeat(33))).toBe(true);
  });

  it("ignores surrounding spaces", () => {
    expect(nameTooLong(`  ${"a".repeat(64)}  `)).toBe(false);
  });
});

describe("certificate reason", () => {
  it("recognises every key file problem and nothing else", () => {
    expect(certificateReason("certificatePassword")).toBe("certificatePassword");
    expect(certificateReason("keyFileFormat")).toBe("keyFileFormat");
    expect(certificateReason("email")).toBeNull();
    expect(certificateReason(undefined)).toBeNull();
  });
});

describe("timestamp address", () => {
  it("flags plain http addresses", () => {
    expect(insecureTimestamp("http://timestamp.example/tsr")).toBe(true);
    expect(insecureTimestamp("  HTTP://Timestamp.example ")).toBe(true);
  });

  it("accepts https and an empty field", () => {
    expect(insecureTimestamp("https://freetsa.org/tsr")).toBe(false);
    expect(insecureTimestamp("")).toBe(false);
  });
});

describe("stamp text round trip", () => {
  it("keeps every line, not only the first", () => {
    const template = "{signer}\n{reason}\n{date}";
    expect(stampTextForInput(template)).toBe("{signer} | {reason} | {date}");
    expect(stampTextFromInput("{signer} | {reason} | {date}")).toBe(template);
  });
});

describe("trust roots", () => {
  const root = (id: string, fingerprint: string): TrustRoot => ({
    id,
    subject: "Kök",
    issuer: "Kök",
    fingerprint,
    validFrom: "2026-01-01T00:00:00+00:00",
    validUntil: "2036-01-01T00:00:00+00:00",
    authority: true,
    selfSigned: true,
    expired: false,
    lists: [],
  });

  it("names a trust list by its operator and territory, or by whichever it has", () => {
    expect(trustSourceName({ kind: "euTrustedList", territory: "DE", name: "Bundesnetzagentur" })).toBe("Bundesnetzagentur (DE)");
    expect(trustSourceName({ kind: "euTrustedList", territory: "FR", name: null })).toBe("FR");
    expect(trustSourceName({ kind: "securitySettings", territory: null, name: "AATL" })).toBe("AATL");
    expect(trustSourceName({ kind: "securitySettings", territory: null, name: null })).toBeNull();
  });

  it("marks only files that hold more than one certificate", () => {
    expect(sharedTrustFiles([root("a.cer", "1"), root("zincir.pem", "2"), root("zincir.pem", "3")])).toEqual(new Set(["zincir.pem"]));
    expect(sharedTrustFiles([])).toEqual(new Set());
  });

  it("shortens a fingerprint into groups of four", () => {
    expect(shortFingerprint("0123456789ABCDEF0123")).toBe("0123 4567 89AB CDEF…");
    expect(shortFingerprint("AB")).toBe("AB…");
  });
});
