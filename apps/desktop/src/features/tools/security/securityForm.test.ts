import { describe, expect, it } from "vitest";
import { DEFAULT_SANITIZE, isReady, legacyPasswordEncodable, optionCount, ownerRepeatsUser, passwordByteLimit, passwordTooLong, removedTotal, reportIsClean, sealAlgorithm, type SecurityFormState } from "./securityForm";
import type { PrivacyReport } from "@/types";

const emptyReport: PrivacyReport = {
  metadata: {},
  xmpMetadata: false,
  javascript: 0,
  embeddedFiles: [],
  fileAttachments: 0,
  annotations: 0,
  links: [],
  linkCount: 0,
  layers: 0,
  hiddenLayers: 0,
  formFields: 0,
  hiddenText: 0,
  bookmarks: 0,
  sensitive: {},
  pageCount: 3,
};

const baseState: SecurityFormState = {
  hasDocument: true,
  documentPassword: false,
  output: "C:/out.pdf",
  userPassword: "",
  ownerPassword: "",
  confirmPassword: "",
  recipients: 0,
  decryptPassword: "",
  sealedPath: "",
  holderPath: "",
  kind: "text",
  text: "",
  imagePath: "",
  templatePath: "",
  stampText: "",
  removeText: "",
  chosenCandidates: 0,
  scanned: false,
  removeAnnotations: true,
  removeImages: true,
  report: null,
  sanitizeOptions: DEFAULT_SANITIZE,
};

const state = (patch: Partial<SecurityFormState>): SecurityFormState => ({ ...baseState, ...patch });

describe("isReady", () => {
  it("needs a document and an output path for every job but opening a sealed file", () => {
    expect(isReady("stamp", state({ stampText: "PAID", hasDocument: false }))).toBe(false);
    expect(isReady("stamp", state({ stampText: "PAID", output: "" }))).toBe(false);
    expect(isReady("stamp", state({ stampText: "PAID" }))).toBe(true);
  });

  it("opens a sealed file from its own two pickers, with no document loaded", () => {
    expect(isReady("decryptCertificate", state({ hasDocument: false, sealedPath: "a.pdf", holderPath: "me.p12" }))).toBe(true);
    expect(isReady("decryptCertificate", state({ hasDocument: false, sealedPath: "a.pdf" }))).toBe(false);
    expect(isReady("decryptCertificate", state({ hasDocument: false, holderPath: "me.p12", output: "" }))).toBe(false);
  });

  it("encrypts on either password but only when the confirmation matches the user password", () => {
    expect(isReady("encrypt", state({ userPassword: "secret", confirmPassword: "secret" }))).toBe(true);
    expect(isReady("encrypt", state({ userPassword: "secret", confirmPassword: "secre" }))).toBe(false);
    expect(isReady("encrypt", state({ ownerPassword: "owner" }))).toBe(true);
    expect(isReady("encrypt", state({ ownerPassword: "owner", userPassword: "secret" }))).toBe(false);
    expect(isReady("encrypt", baseState)).toBe(false);
  });

  it("decrypts with a typed password or the one the document was already opened with", () => {
    expect(isReady("decrypt", state({ decryptPassword: "x" }))).toBe(true);
    expect(isReady("decrypt", state({ documentPassword: true }))).toBe(true);
    expect(isReady("decrypt", baseState)).toBe(false);
  });

  it("removes permissions-only protection without asking for a password", () => {
    expect(isReady("decrypt", state({ ownerOnly: true }))).toBe(true);
    expect(isReady("decrypt", state({ ownerOnly: true, output: "" }))).toBe(false);
    expect(isReady("decrypt", state({ ownerOnly: false }))).toBe(false);
  });

  it("decrypts a still-locked source once the password is typed in the tool", () => {
    expect(isReady("decrypt", state({ hasDocument: false, hasSource: true, decryptPassword: "x" }))).toBe(true);
    expect(isReady("decrypt", state({ hasDocument: false, hasSource: true }))).toBe(false);
    expect(isReady("decrypt", state({ hasDocument: false, hasSource: false, decryptPassword: "x" }))).toBe(false);
    expect(isReady("encrypt", state({ hasDocument: false, hasSource: true, userPassword: "a", confirmPassword: "a" }))).toBe(false);
  });

  it("seals only once a recipient certificate is listed", () => {
    expect(isReady("certificate", state({ recipients: 1 }))).toBe(true);
    expect(isReady("certificate", baseState)).toBe(false);
  });

  it("asks the watermark for whichever source its kind needs", () => {
    expect(isReady("watermark", state({ kind: "text", text: "   " }))).toBe(false);
    expect(isReady("watermark", state({ kind: "text", text: " DRAFT " }))).toBe(true);
    expect(isReady("watermark", state({ kind: "image", text: "DRAFT" }))).toBe(false);
    expect(isReady("watermark", state({ kind: "image", imagePath: "logo.png" }))).toBe(true);
    expect(isReady("watermark", state({ kind: "pdf", imagePath: "logo.png" }))).toBe(false);
    expect(isReady("watermark", state({ kind: "pdf", templatePath: "mark.pdf" }))).toBe(true);
  });

  it("removes a watermark by typed text, by a picked candidate, or by the blanket switches before a scan", () => {
    expect(isReady("removeWatermark", state({ removeText: " KOPYA " }))).toBe(true);
    expect(isReady("removeWatermark", state({ scanned: true, chosenCandidates: 1 }))).toBe(true);
    expect(isReady("removeWatermark", baseState)).toBe(true);
    expect(isReady("removeWatermark", state({ scanned: true }))).toBe(false);
    expect(isReady("removeWatermark", state({ removeAnnotations: false, removeImages: false }))).toBe(false);
  });

  it("sanitises only when a ticked option has something to remove", () => {
    expect(isReady("privacy", state({ report: emptyReport }))).toBe(false);
    expect(isReady("privacy", state({ report: { ...emptyReport, javascript: 2 } }))).toBe(true);
    expect(isReady("privacy", state({ report: { ...emptyReport, annotations: 4 } }))).toBe(false);
    expect(isReady("privacy", state({ report: { ...emptyReport, annotations: 4 }, sanitizeOptions: { ...DEFAULT_SANITIZE, annotations: true } }))).toBe(true);
    expect(isReady("privacy", baseState)).toBe(false);
  });
});

describe("optionCount", () => {
  it("counts each option from the field of the report that carries it", () => {
    const report: PrivacyReport = { ...emptyReport, metadata: { Author: "A", Title: "B" }, xmpMetadata: true, embeddedFiles: ["a.txt"], linkCount: 7, formFields: 3 };
    expect(optionCount(report, "metadata")).toBe(2);
    expect(optionCount(report, "xmpMetadata")).toBe(1);
    expect(optionCount(report, "embeddedFiles")).toBe(1);
    expect(optionCount(report, "links")).toBe(7);
    expect(optionCount(report, "resetForms")).toBe(3);
  });
});

describe("reportIsClean", () => {
  it("ignores bookmarks and form fields, which are not leaks", () => {
    expect(reportIsClean(emptyReport)).toBe(true);
    expect(reportIsClean({ ...emptyReport, bookmarks: 9, formFields: 4 })).toBe(true);
    expect(reportIsClean({ ...emptyReport, hiddenText: 1 })).toBe(false);
    expect(reportIsClean({ ...emptyReport, sensitive: { email: 2 } })).toBe(false);
  });
});

describe("page thumbnails", () => {
  it("counts old page thumbnails and removes them by default", () => {
    expect(optionCount(emptyReport, "thumbnails")).toBe(0);
    const withThumbs = { ...emptyReport, thumbnails: 3 };
    expect(optionCount(withThumbs, "thumbnails")).toBe(3);
    expect(reportIsClean(withThumbs)).toBe(false);
    expect(DEFAULT_SANITIZE.thumbnails).toBe(true);
  });
});

describe("sealing algorithm", () => {
  it("never seals with RC4", () => {
    expect(sealAlgorithm("rc4")).toBe("aes128");
    expect(sealAlgorithm("aes128")).toBe("aes128");
    expect(sealAlgorithm("aes256")).toBe("aes256");
  });
});

describe("photo details", () => {
  it("counts photos that carry camera or location details and removes them by default", () => {
    expect(optionCount(emptyReport, "imageMetadata")).toBe(0);
    expect(optionCount({ ...emptyReport, imageMetadata: 2 }, "imageMetadata")).toBe(2);
    expect(reportIsClean({ ...emptyReport, imageMetadata: 2 })).toBe(false);
    expect(DEFAULT_SANITIZE.imageMetadata).toBe(true);
  });
});

describe("content outside the page", () => {
  it("counts cropped content and keeps the report from reading as clean", () => {
    expect(optionCount(emptyReport, "offPage")).toBe(0);
    const cropped = { ...emptyReport, offPageContent: 4 };
    expect(optionCount(cropped, "offPage")).toBe(4);
    expect(reportIsClean(cropped)).toBe(false);
  });

  it("is left alone unless it is ticked", () => {
    expect(DEFAULT_SANITIZE.offPage).toBe(false);
  });
});

describe("removedTotal", () => {
  const output = { output: "C:/out.pdf", pageCount: 3, bytes: 1024 };

  it("sums a sanitise result, sums a watermark removal, and reports nothing for a plain output", () => {
    expect(removedTotal({ ...output, removed: { metadata: 2, javascript: 1, links: undefined } })).toBe(3);
    expect(removedTotal({ ...output, removedText: 4, removedAnnotations: 1, removedImages: 2, removedMarks: 0, repaintedPages: 0 })).toBe(7);
    expect(removedTotal({ ...output, removedText: 0, removedAnnotations: 0, removedImages: 0, removedMarks: 3, repaintedPages: 0 })).toBe(3);
    expect(removedTotal({ ...output, removedText: 0, removedAnnotations: 0, removedImages: 0, removedMarks: 0, repaintedPages: 6 })).toBe(6);
    expect(removedTotal(output)).toBeNull();
  });
});

describe("encryption password limits", () => {
  it("keeps passwords longer than 40 characters within the AES-256 byte limit", () => {
    const long = "correct horse battery staple ".repeat(2);
    expect(passwordTooLong(long, "aes256")).toBe(false);
    expect(isReady("encrypt", state({ userPassword: long, confirmPassword: long, algorithm: "aes256" }))).toBe(true);
  });

  it("counts multi-byte letters against the AES-256 limit", () => {
    expect(passwordByteLimit("aes256")).toBe(127);
    expect(passwordTooLong("ş".repeat(63), "aes256")).toBe(false);
    expect(passwordTooLong("ş".repeat(64), "aes256")).toBe(true);
    const long = "ş".repeat(64);
    expect(isReady("encrypt", state({ userPassword: long, confirmPassword: long, algorithm: "aes256" }))).toBe(false);
  });

  it("holds the legacy algorithms to 32 characters", () => {
    expect(passwordByteLimit("rc4")).toBe(32);
    expect(passwordTooLong("x".repeat(32), "aes128")).toBe(false);
    expect(passwordTooLong("x".repeat(33), "rc4")).toBe(true);
    expect(isReady("encrypt", state({ ownerPassword: "x".repeat(33), algorithm: "aes128" }))).toBe(false);
  });

  it("refuses an owner password equal to the open password only when permissions are limited", () => {
    expect(ownerRepeatsUser("same", "same", true)).toBe(true);
    expect(ownerRepeatsUser("same", "same", false)).toBe(false);
    expect(ownerRepeatsUser("", "", true)).toBe(false);
    const typed = { userPassword: "same", confirmPassword: "same", ownerPassword: "same" };
    expect(isReady("encrypt", state({ ...typed, permissionsRestricted: true }))).toBe(false);
    expect(isReady("encrypt", state({ ...typed, permissionsRestricted: false }))).toBe(true);
  });
});

describe("legacy encryption passwords", () => {
  it("accepts what PDFDocEncoding can hold and refuses the rest", () => {
    expect(legacyPasswordEncodable("abcÇÜÖ")).toBe(true);
    expect(legacyPasswordEncodable("ı")).toBe(true);
    expect(legacyPasswordEncodable("şifre")).toBe(false);
    expect(legacyPasswordEncodable("İstanbul")).toBe(false);
  });

  it("holds the button for a Turkish password under RC4 or AES-128 only", () => {
    const typed = { userPassword: "şifre", confirmPassword: "şifre" };
    expect(isReady("encrypt", state({ ...typed, algorithm: "aes256" }))).toBe(true);
    expect(isReady("encrypt", state({ ...typed, algorithm: "rc4" }))).toBe(false);
    expect(isReady("encrypt", state({ ...typed, algorithm: "aes128" }))).toBe(false);
    expect(isReady("encrypt", state({ userPassword: "abc", confirmPassword: "abc", ownerPassword: "Ğ", algorithm: "aes128" }))).toBe(false);
  });
});

describe("private application data", () => {
  it("is counted from the report and removed by default", () => {
    expect(optionCount({ ...emptyReport, privateData: 2 }, "privateData")).toBe(2);
    expect(optionCount(emptyReport, "privateData")).toBe(0);
    expect(DEFAULT_SANITIZE.privateData).toBe(true);
    expect(reportIsClean({ ...emptyReport, privateData: 1 })).toBe(false);
  });
});
