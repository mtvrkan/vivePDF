import { beforeEach, describe, expect, it } from "vitest";
import type { EditorPending } from "@/shared/store/viewerOverlayStore";
import { clipboardText, holdsEditorObject, toClipboardObject, useEditorClipboard, type EditorClipboardEntry } from "./editorClipboard";
import { imagePreviewKey } from "./layers";

const SOURCE = { documentId: "doc", path: "C:/docs/source.pdf", password: "secret", imagePreviews: {} };
const RUN = { text: "Merhaba", font: "Roboto", fontXref: 9, size: 14, color: "#222222", bold: false, italic: false, superscript: false };

function block(overrides: Partial<Extract<EditorPending, { kind: "block" }>> = {}): Extract<EditorPending, { kind: "block" }> {
  const style = { fontSize: 14, color: "#222222", bold: false, italic: false, font: "Roboto", align: "justify" as const, lineHeight: 1.2 };
  return {
    id: "b1",
    kind: "block",
    pageIndex: 2,
    x: 20,
    y: 30,
    width: 200,
    height: 40,
    text: "Merhaba",
    original: "Merhaba",
    originalRect: { x: 20, y: 30, width: 200, height: 40 },
    blockId: "t0",
    style,
    originalStyle: { ...style },
    fontXref: 9,
    fontExt: "ttf",
    fontFamily: "Roboto",
    runs: [{ ...RUN }],
    originalRuns: [{ ...RUN }],
    firstLineIndent: 0,
    leading: 0,
    rotated: false,
    fittedSize: null,
    opacity: 0.8,
    ...overrides,
  };
}

function imageChange(overrides: Partial<Extract<EditorPending, { kind: "imageChange" }>> = {}): Extract<EditorPending, { kind: "imageChange" }> {
  return {
    id: "i1",
    kind: "imageChange",
    pageIndex: 1,
    x: 10,
    y: 10,
    width: 80,
    height: 40,
    blockId: "i0",
    xref: 12,
    original: { x: 10, y: 10, width: 80, height: 40 },
    deleted: false,
    aspect: 2,
    aspectLocked: true,
    replacement: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    opacity: 1,
    placementRotation: 0,
    ...overrides,
  };
}

describe("toClipboardObject", () => {
  it("turns a paragraph into a text object that points at its source file for the embedded font", () => {
    const copied = toClipboardObject(block(), SOURCE);

    expect(copied?.kind).toBe("text");
    if (copied?.kind !== "text") return;
    expect(copied.runs).toEqual([RUN]);
    expect(copied.style.align).toBe("left");
    expect(copied.opacity).toBe(0.8);
    expect(copied.fontSource).toMatchObject({ path: "C:/docs/source.pdf", password: "secret" });
    expect(copied.fontSource?.key.startsWith("clip-")).toBe(true);
  });

  it("leaves the font source out when no run uses an embedded font", () => {
    const copied = toClipboardObject(block({ runs: [{ ...RUN, fontXref: 0 }] }), SOURCE);

    expect(copied?.kind === "text" && copied.fontSource).toBeFalsy();
  });

  it("keeps the font source a pasted text already carries", () => {
    const pasted = { id: "t1", kind: "text" as const, pageIndex: 0, x: 0, y: 0, width: 10, height: 10, text: "a", style: { fontSize: 12, color: "#000000", bold: false, align: "left" as const }, opacity: 1, runs: [{ ...RUN }], fontSource: { path: "C:/docs/first.pdf", password: null, key: "clip-first" } };

    const copied = toClipboardObject(pasted, SOURCE);

    expect(copied?.kind === "text" && copied.fontSource).toEqual({ path: "C:/docs/first.pdf", password: null, key: "clip-first" });
  });

  it("copies a page picture through its loaded preview", () => {
    const imagePreviews = { [imagePreviewKey("doc", 1, 12)]: "data:image/png;base64,AAAA" };

    const copied = toClipboardObject(imageChange(), { ...SOURCE, imagePreviews });

    expect(copied).toMatchObject({ kind: "image", dataUrl: "data:image/png;base64,AAAA", aspect: 2, width: 80, height: 40 });
  });

  it("refuses a page picture whose preview has not loaded yet", () => {
    expect(toClipboardObject(imageChange(), SOURCE)).toBeNull();
  });
});

describe("clipboardText", () => {
  it("returns the text of a text object and nothing for a picture or blank text", () => {
    const text = toClipboardObject(block(), SOURCE);
    const blank = toClipboardObject(block({ text: "   " }), SOURCE);
    const picture = toClipboardObject(imageChange({ replacement: { dataUrl: "data:image/png;base64,BBBB", width: 80, height: 40, path: null } }), SOURCE);

    expect(text && clipboardText(text)).toBe("Merhaba");
    expect(blank && clipboardText(blank)).toBeNull();
    expect(picture && clipboardText(picture)).toBeNull();
  });
});

describe("useEditorClipboard paste requests", () => {
  beforeEach(() => useEditorClipboard.setState({ entry: null, pasteRequest: null }));

  it("hands a paste request only to the document it was made for, once", () => {
    useEditorClipboard.getState().requestPaste({ documentId: "b", pageIndex: 3, point: { x: 5, y: 6 } });

    const other = useEditorClipboard.getState().takePasteRequest("a");
    const own = useEditorClipboard.getState().takePasteRequest("b");
    const again = useEditorClipboard.getState().takePasteRequest("b");

    expect(other).toBeNull();
    expect(own).toEqual({ documentId: "b", pageIndex: 3, point: { x: 5, y: 6 } });
    expect(again).toBeNull();
  });
});

describe("holdsEditorObject", () => {
  const entry = { object: toClipboardObject(block(), SOURCE), documentId: "doc", pageIndex: 2, systemText: "Merhaba" } as EditorClipboardEntry;

  function data(text: string, files: File[] = []) {
    return { getData: () => text, files: files as unknown as FileList, items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) as unknown as DataTransferItemList };
  }

  it("recognises the text written when the object was copied", () => {
    expect(holdsEditorObject(data("Merhaba"), entry)).toBe(true);
    expect(holdsEditorObject(data(""), entry)).toBe(true);
  });

  it("treats text copied elsewhere afterwards as not ours", () => {
    expect(holdsEditorObject(data("başka bir şey"), entry)).toBe(false);
  });

  it("treats a picture on the clipboard as not ours", () => {
    expect(holdsEditorObject(data("", [new File(["x"], "a.png", { type: "image/png" })]), entry)).toBe(false);
  });
});
