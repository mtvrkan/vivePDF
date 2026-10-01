import { describe, expect, it } from "vitest";
import { resultOpenLabelKey } from "./resultOpenLabel";

describe("resultOpenLabelKey", () => {
  it("offers the viewer for PDF results", () => {
    expect(resultOpenLabelKey("C:/out/report.PDF")).toBe("tools.openResult");
  });

  it("offers the default app for every other result", () => {
    expect(resultOpenLabelKey("C:/out/report.xlsx")).toBe("tools.openFile");
    expect(resultOpenLabelKey("C:/out/report.docx")).toBe("tools.openFile");
    expect(resultOpenLabelKey("C:/out/page-1.png")).toBe("tools.openFile");
  });
});
