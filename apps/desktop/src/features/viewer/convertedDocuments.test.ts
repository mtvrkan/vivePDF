import { beforeEach, describe, expect, it } from "vitest";
import { convertedCopyOf, isConvertibleOnOpen, isOpenablePath, originalOf, sessionPathOf, useConvertedStore } from "./convertedDocuments";

beforeEach(() => {
  useConvertedStore.setState({ originals: {} });
});

describe("openable files", () => {
  it("opens PDFs directly and Office, text, e-book and picture files through a conversion", () => {
    expect(isOpenablePath("C:/Docs/a.PDF")).toBe(true);
    expect(isConvertibleOnOpen("C:/Docs/a.PDF")).toBe(false);
    for (const name of ["report.docx", "slides.pptx", "book.epub", "notes.md", "scan.HEIC", "table.csv", "invite.eml", "Weekly.MSG"]) {
      expect(isConvertibleOnOpen(`C:/Docs/${name}`)).toBe(true);
    }
  });

  it("refuses files without a known type", () => {
    expect(isOpenablePath("C:/Docs/archive.zip")).toBe(false);
    expect(isOpenablePath("C:/Docs/README")).toBe(false);
  });
});

describe("useConvertedStore", () => {
  it("maps a converted copy back to its original for recents and the session", () => {
    useConvertedStore.getState().remember("C:\\Temp\\x\\report.pdf", "C:/Docs/report.docx");

    expect(originalOf("c:/temp/x/report.pdf")).toBe("C:/Docs/report.docx");
    expect(sessionPathOf("C:\\Temp\\x\\report.pdf")).toBe("C:/Docs/report.docx");
    expect(convertedCopyOf("c:\\docs\\REPORT.docx")).toBe("c:/temp/x/report.pdf");
  });

  it("keeps other paths as they are and forgets a copy once it is saved", () => {
    useConvertedStore.getState().remember("C:/Temp/x/report.pdf", "C:/Docs/report.docx");

    useConvertedStore.getState().forget("C:/Temp/x/report.pdf");

    expect(sessionPathOf("C:/Temp/x/report.pdf")).toBe("C:/Temp/x/report.pdf");
    expect(convertedCopyOf("C:/Docs/report.docx")).toBeNull();
  });
});
