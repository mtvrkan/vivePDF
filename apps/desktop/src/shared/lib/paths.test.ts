import { afterEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { basenameOf, dirnameOf, joinPath, outputDirectoryFor, pageFileUrl, siblingPath, stemOf, suggestOutputPath } from "./paths";

afterEach(() => {
  vi.restoreAllMocks();
});

function withPreferences(patch: { outputMode: "beside" | "folder"; outputFolder?: string }) {
  const state = { ...usePreferencesStore.getState(), outputFolder: "", ...patch };
  vi.spyOn(usePreferencesStore, "getState").mockReturnValue(state);
}

describe("paths", () => {
  it("handles windows paths", () => {
    const path = "C:\\Users\\PC\\Desktop\\pdf\\BMG (1).pdf";
    expect(dirnameOf(path)).toBe("C:\\Users\\PC\\Desktop\\pdf");
    expect(basenameOf(path)).toBe("BMG (1).pdf");
    expect(stemOf(path)).toBe("BMG (1)");
    expect(suggestOutputPath(path, "compressed")).toBe("C:\\Users\\PC\\Desktop\\pdf\\BMG (1)-compressed.pdf");
  });

  it("handles posix paths", () => {
    const path = "/home/user/docs/report.final.pdf";
    expect(stemOf(path)).toBe("report.final");
    expect(joinPath("/home/user/docs/", "a.pdf")).toBe("/home/user/docs/a.pdf");
    expect(suggestOutputPath(path, "merged")).toBe("/home/user/docs/report.final-merged.pdf");
  });

  it("joins into an empty directory as a bare name", () => {
    expect(joinPath("", "x.pdf")).toBe("x.pdf");
  });
});

describe("output directory", () => {
  it("writes next to the source by default", () => {
    withPreferences({ outputMode: "beside" });
    expect(outputDirectoryFor("C:\\docs\\report.pdf")).toBe("C:\\docs");
  });

  it("uses the fixed folder once one is chosen", () => {
    withPreferences({ outputMode: "folder", outputFolder: "D:\\outputs" });
    expect(outputDirectoryFor("C:\\docs\\report.pdf")).toBe("D:\\outputs");
    expect(suggestOutputPath("C:\\docs\\report.pdf", "ocr")).toBe("D:\\outputs\\report-ocr.pdf");
    expect(siblingPath("C:\\docs\\report.pdf", "docx")).toBe("D:\\outputs\\report.docx");
  });

  it("falls back to the source folder when the fixed folder is empty", () => {
    withPreferences({ outputMode: "folder" });
    expect(outputDirectoryFor("C:\\docs\\report.pdf")).toBe("C:\\docs");
  });
});

describe("pageFileUrl", () => {
  it("builds a file url that opens a Windows document at a page", () => {
    expect(pageFileUrl("C:\\Tez Çalışması\\makale #2.pdf", 12)).toBe("file:///C:/Tez%20%C3%87al%C4%B1%C5%9Fmas%C4%B1/makale%20%232.pdf#page=12");
  });

  it("keeps posix paths rooted", () => {
    expect(pageFileUrl("/home/ada/paper.pdf", 3)).toBe("file:///home/ada/paper.pdf#page=3");
  });

  it("never points before the first page", () => {
    expect(pageFileUrl("/tmp/a.pdf", 0)).toBe("file:///tmp/a.pdf#page=1");
  });
});
