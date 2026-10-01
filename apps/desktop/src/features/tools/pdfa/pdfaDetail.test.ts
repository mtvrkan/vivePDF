import { describe, expect, it } from "vitest";
import type { PdfaCheck, PdfaReport } from "@/types";
import { pdfaComparison, pdfaDetailKey } from "./pdfaDetail";

const check = (item: Partial<PdfaCheck> & Pick<PdfaCheck, "id">): PdfaCheck => ({ status: "fail", fixable: true, ...item });
const report = (checks: PdfaCheck[]): PdfaReport => ({ level: "2b", pageCount: 1, claimed: null, checks, ready: false, convertible: true });

describe("pdfaDetailKey", () => {
  it("uses the plain pass and fail messages by default", () => {
    expect(pdfaDetailKey(check({ id: "fonts", status: "pass" }), "2b")).toBe("tools.pdfa.checks.fonts.pass");
    expect(pdfaDetailKey(check({ id: "fonts" }), "2b")).toBe("tools.pdfa.checks.fonts.fail");
  });

  it("explains a metadata claim for another level", () => {
    expect(pdfaDetailKey(check({ id: "metadata", value: "PDF/A-1b" }), "2b")).toBe("tools.pdfa.checks.metadata.other");
    expect(pdfaDetailKey(check({ id: "metadata" }), "2b")).toBe("tools.pdfa.checks.metadata.fail");
  });

  it("follows the level for attachments and layers", () => {
    expect(pdfaDetailKey(check({ id: "attachments" }), "3b")).toBe("tools.pdfa.checks.attachments.link");
    expect(pdfaDetailKey(check({ id: "attachments", status: "pass" }), "3b")).toBe("tools.pdfa.checks.attachments.passLinked");
    expect(pdfaDetailKey(check({ id: "attachments" }), "2u")).toBe("tools.pdfa.checks.attachments.fail");
    expect(pdfaDetailKey(check({ id: "layers" }), "1b")).toBe("tools.pdfa.checks.layers.merge");
    expect(pdfaDetailKey(check({ id: "layers", fixable: false }), "1b")).toBe("tools.pdfa.checks.layers.hidden");
    expect(pdfaDetailKey(check({ id: "layers" }), "2b")).toBe("tools.pdfa.checks.layers.fail");
  });

  it("separates removable transparency groups and old colour profiles", () => {
    expect(pdfaDetailKey(check({ id: "transparency" }), "1b")).toBe("tools.pdfa.checks.transparency.groups");
    expect(pdfaDetailKey(check({ id: "transparency", fixable: false }), "1b")).toBe("tools.pdfa.checks.transparency.fail");
    expect(pdfaDetailKey(check({ id: "outputIntent", value: "iccVersion" }), "1b")).toBe("tools.pdfa.checks.outputIntent.iccVersion");
    expect(pdfaDetailKey(check({ id: "outputIntent", value: "iccVersion", fixable: false }), "1b")).toBe("tools.pdfa.checks.outputIntent.iccVersionCmyk");
  });
});

describe("pdfaComparison", () => {
  it("lists every check that failed before or after the conversion", () => {
    const before = report([check({ id: "fonts" }), check({ id: "colour", status: "pass" }), check({ id: "actions", status: "pass" }), check({ id: "unicode", fixable: false })]);
    const after = report([check({ id: "fonts", status: "pass" }), check({ id: "colour" }), check({ id: "actions", status: "pass" }), check({ id: "unicode" })]);
    expect(pdfaComparison(before, after)).toEqual([
      { id: "fonts", before: "fixable", after: "pass" },
      { id: "colour", before: "pass", after: "fail" },
      { id: "unicode", before: "blocking", after: "fail" },
    ]);
  });

  it("adds checks that only the converted copy reports", () => {
    const rows = pdfaComparison(report([]), report([check({ id: "objectStreams" }), check({ id: "fonts", status: "pass" })]));
    expect(rows).toEqual([{ id: "objectStreams", before: "pass", after: "fail" }]);
  });

  it("is empty when nothing failed", () => {
    expect(pdfaComparison(report([check({ id: "fonts", status: "pass" })]), report([check({ id: "fonts", status: "pass" })]))).toEqual([]);
  });
});
