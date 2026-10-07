import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./embeddedFonts", () => ({ loadEmbeddedFont: vi.fn() }));

import { useDocumentStore } from "@/shared/store/documentStore";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { useEditorClipboard } from "./editorClipboard";
import { centredOn, copyEditorObject, fitPicture, pastePlainText } from "./editorPaste";
import { layerKey } from "./layers";

const TEXT: EditorPending = { id: "t1", kind: "text", pageIndex: 0, x: 40, y: 50, width: 120, height: 30, text: "Kopyala beni", style: { fontSize: 12, color: "#000000", bold: false, align: "left" }, opacity: 1 };

function openDocument() {
  useDocumentStore.setState({ documents: { doc: { id: "doc", path: "C:/docs/a.pdf", password: null, info: { pageSizes: [{ width: 600, height: 800, rotation: 0 }] } } } as never });
}

describe("fitPicture", () => {
  it("shrinks a large picture to sixty percent of the page and keeps its aspect", () => {
    expect(fitPicture({ width: 2000, height: 1000 }, { width: 600, height: 800 })).toEqual({ width: 360, height: 180 });
  });

  it("keeps a small picture at its natural size", () => {
    expect(fitPicture({ width: 100, height: 50 }, { width: 600, height: 800 })).toEqual({ width: 100, height: 50 });
  });

  it("treats an empty picture as one point square", () => {
    expect(fitPicture({ width: 0, height: 0 }, { width: 600, height: 800 })).toEqual({ width: 1, height: 1 });
  });
});

describe("centredOn", () => {
  it("centres the object on the page when there is no point", () => {
    expect(centredOn({ width: 600, height: 800 }, { width: 200, height: 100 }, null)).toEqual({ x: 200, y: 350 });
  });

  it("keeps an object placed at a point inside the page", () => {
    expect(centredOn({ width: 600, height: 800 }, { width: 200, height: 100 }, { x: 550, y: -20 })).toEqual({ x: 400, y: 0 });
  });
});

describe("pastePlainText", () => {
  beforeEach(() => {
    openDocument();
    useViewerOverlayStore.setState({ objects: [], past: [], future: [] });
  });

  it("adds a text box half the page wide holding the outside text", () => {
    const pasted = pastePlainText("doc", 0, "  satır bir\r\nsatır iki  ", null);

    expect(pasted).toMatchObject({ kind: "text", pageIndex: 0, text: "satır bir\nsatır iki", width: 300 });
    expect(useViewerOverlayStore.getState().objects).toHaveLength(1);
    expect(useViewerOverlayStore.getState().past).toHaveLength(1);
  });

  it("ignores text that is only whitespace", () => {
    expect(pastePlainText("doc", 0, " \n\t ", null)).toBeNull();
    expect(useViewerOverlayStore.getState().objects).toHaveLength(0);
  });
});

describe("copyEditorObject", () => {
  beforeEach(() => {
    openDocument();
    useEditorClipboard.setState({ entry: null, pasteRequest: null });
    useViewerOverlayStore.setState({ objects: [TEXT], past: [], future: [], lockedLayerKeys: {} });
  });

  it("puts the object and its text on the editor clipboard", () => {
    expect(copyEditorObject("doc", TEXT, false)).toBe("copied");

    const entry = useEditorClipboard.getState().entry;
    expect(entry).toMatchObject({ documentId: "doc", pageIndex: 0, systemText: "Kopyala beni" });
    expect(useViewerOverlayStore.getState().objects).toHaveLength(1);
  });

  it("removes a new text object when it is cut", () => {
    expect(copyEditorObject("doc", TEXT, true)).toBe("copied");

    expect(useViewerOverlayStore.getState().objects).toHaveLength(0);
    expect(useEditorClipboard.getState().entry?.object.kind).toBe("text");
  });

  it("refuses to cut a locked object and leaves the clipboard alone", () => {
    useViewerOverlayStore.setState({ lockedLayerKeys: { [layerKey(0, "t1")]: true } });

    expect(copyEditorObject("doc", TEXT, true)).toBe("locked");

    expect(useViewerOverlayStore.getState().objects).toHaveLength(1);
    expect(useEditorClipboard.getState().entry).toBeNull();
  });

  it("reports an unknown document as unavailable", () => {
    expect(copyEditorObject("missing", TEXT, false)).toBe("unavailable");
  });
});
