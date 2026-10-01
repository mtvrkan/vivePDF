import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const save = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...args: unknown[]) => save(...args) }));

import { detailWithPages, formatCheckReport, reportFormatOf, saveCheckReport, type CheckReportDocument } from "./checkReport";

const report: CheckReportDocument = {
  heading: "Erişilebilirlik raporu",
  source: "C:\\Belgeler\\rapor ş.pdf",
  generatedAt: "2026-09-18 10:00",
  summary: ["Puan: 80"],
  columns: { check: "Denetim", status: "Durum", detail: "Ayrıntı" },
  statusLabels: { pass: "Geçti", warn: "Uyarı", fail: "Başarısız" },
  rows: [
    { id: "title", status: "fail", title: "Başlık", detail: "=HYPERLINK(\"x\")" },
    { id: "tagged", status: "pass", title: "Etiket | yapı", detail: "satır\nikinci, \"alıntı\"" },
  ],
  extra: { title: "Gömülmemiş yazı tipleri", lines: ["Arial"] },
};

describe("reportFormatOf", () => {
  it("picks the format from the extension and falls back to markdown", () => {
    expect(reportFormatOf("a/b.CSV")).toBe("csv");
    expect(reportFormatOf("a/b.json")).toBe("json");
    expect(reportFormatOf("a/b.md")).toBe("md");
    expect(reportFormatOf("a/b")).toBe("md");
  });
});

describe("formatCheckReport", () => {
  it("writes a markdown table with escaped pipes and the extra list", () => {
    const text = formatCheckReport(report, "md");
    expect(text.startsWith("# Erişilebilirlik raporu\n")).toBe(true);
    expect(text).toContain("| Etiket \\| yapı | Geçti | satır ikinci, \"alıntı\" |");
    expect(text).toContain("## Gömülmemiş yazı tipleri");
    expect(text).toContain("- Arial");
  });

  it("writes csv with a BOM, quoting and a formula guard", () => {
    const text = formatCheckReport(report, "csv");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Denetim,Durum,Ayrıntı");
    expect(lines[1]).toBe("Başlık,Başarısız,\"'=HYPERLINK(\"\"x\"\")\"");
    expect(text).toContain("\"satır\nikinci, \"\"alıntı\"\"\"");
  });

  it("writes json that parses back with the check ids", () => {
    const parsed = JSON.parse(formatCheckReport(report, "json")) as { checks: { id: string; status: string }[]; details: { lines: string[] } };
    expect(parsed.checks.map((item) => item.id)).toEqual(["title", "tagged"]);
    expect(parsed.checks[0].status).toBe("fail");
    expect(parsed.details.lines).toEqual(["Arial"]);
  });
});

describe("saveCheckReport", () => {
  beforeEach(() => {
    invoke.mockReset();
    save.mockReset();
  });

  it("does nothing when the dialog is dismissed", async () => {
    save.mockResolvedValue(null);
    await expect(saveCheckReport(report, "rapor.md", "Rapor")).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes the format matching the chosen extension", async () => {
    save.mockResolvedValue("C:\\out\\rapor.csv");
    invoke.mockResolvedValue(undefined);
    await expect(saveCheckReport(report, "rapor.md", "Rapor")).resolves.toBe("C:\\out\\rapor.csv");
    const [command, args] = invoke.mock.calls[0] as [string, { path: string; contents: string }];
    expect(command).toBe("write_text_file");
    expect(args.contents.charCodeAt(0)).toBe(0xfeff);
  });

  it("rethrows a write failure as an rpc error", async () => {
    save.mockResolvedValue("C:\\out\\rapor.json");
    invoke.mockRejectedValue({ code: "PERMISSION_DENIED", message: "denied" });
    await expect(saveCheckReport(report, "rapor.md", "Rapor")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("detailWithPages", () => {
  it("appends the page list after the detail", () => {
    expect(detailWithPages("2 fonts", [1, 4], (list) => `Pages: ${list}`)).toBe("2 fonts · Pages: 1, 4");
  });

  it("keeps the detail alone when there are no pages", () => {
    expect(detailWithPages("Fine", [], (list) => `Pages: ${list}`)).toBe("Fine");
    expect(detailWithPages("Fine", undefined, (list) => `Pages: ${list}`)).toBe("Fine");
  });
});
