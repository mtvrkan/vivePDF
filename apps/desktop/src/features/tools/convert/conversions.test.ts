import { describe, expect, it } from "vitest";
import { batchOutputName, batchOutputPaths, moveItem, pageList } from "./conversions";

describe("batchOutputName", () => {
  it("names a file after its own stem when no other file shares it", () => {
    expect(batchOutputName(["C:\\a\\rapor.docx", "C:\\a\\tablo.xlsx"], "C:\\a\\rapor.docx")).toBe("rapor.pdf");
  });

  it("keeps the extension when two files would otherwise produce the same PDF", () => {
    const files = ["C:\\a\\Rapor.docx", "C:\\b\\rapor.xlsx"];
    expect(batchOutputName(files, files[0])).toBe("Rapor-docx.pdf");
    expect(batchOutputName(files, files[1])).toBe("rapor-xlsx.pdf");
  });

  it("handles names with several dots and Turkish characters", () => {
    expect(batchOutputName(["/x/ş ğ.v2.md"], "/x/ş ğ.v2.md")).toBe("ş ğ.v2.pdf");
  });
});

describe("batchOutputPaths", () => {
  it("numbers names that would still land on the same PDF", () => {
    expect(batchOutputPaths(["C:\\a\\r.docx", "C:\\b\\r.docx", "C:\\c\\R.docx"], "C:\\out")).toEqual([
      "C:\\out\\r-docx.pdf",
      "C:\\out\\r-docx (2).pdf",
      "C:\\out\\R-docx (3).pdf",
    ]);
  });

  it("writes each PDF beside its file when no folder is chosen", () => {
    expect(batchOutputPaths(["C:\\a\\r.docx", "C:\\b\\s.xlsx"])).toEqual(["C:\\a\\r.pdf", "C:\\b\\s.pdf"]);
  });

  it("does not number files that only share a name across folders when each stays beside its file", () => {
    expect(batchOutputPaths(["C:\\a\\r.docx", "C:\\b\\r.docx"], "")).toEqual(["C:\\a\\r-docx.pdf", "C:\\b\\r-docx.pdf"]);
  });
});

describe("moveItem", () => {
  it("moves an entry one place up or down", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("returns the list unchanged when the move would leave it", () => {
    const items = ["a", "b"];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});

describe("pageList", () => {
  it("collapses consecutive pages into ranges", () => {
    expect(pageList([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });

  it("sorts, removes duplicates and handles a single page", () => {
    expect(pageList([9, 4, 4])).toBe("4, 9");
    expect(pageList([12])).toBe("12");
    expect(pageList([])).toBe("");
  });
});
