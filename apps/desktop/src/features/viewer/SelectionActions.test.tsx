import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

const DOCUMENT_ID = "doc-selection";
const highlightRects = { "0": [{ origin: { x: 10, y: 20 }, size: { width: 40, height: 8 } }] };
const created: PdfAnnotationObject[] = [];
const createAnnotation = vi.fn((_pageIndex: number, object: PdfAnnotationObject) => created.push(object));
const clear = vi.fn();
let endSelection: (() => void) | null = null;

const scope = {
  onEndSelection: (callback: () => void) => {
    endSelection = callback;
    return () => undefined;
  },
  onSelectionChange: () => () => undefined,
  onEmptySpaceClick: () => () => undefined,
  getSelectedText: () => ({ toPromise: () => Promise.resolve(["selected words"]) }),
  getHighlightRects: () => highlightRects,
  clear,
};

vi.mock("@embedpdf/plugin-selection/react", () => ({ useSelectionCapability: () => ({ provides: { forDocument: () => scope } }) }));
vi.mock("@embedpdf/plugin-redaction/react", () => ({ useRedaction: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-annotation/react", () => ({
  useAnnotation: () => ({ provides: { createAnnotation } }),
  useAnnotationCapability: () => ({ provides: { getTool: (toolId: string) => (toolId === "highlight" ? { defaults: { color: "#FFD400", opacity: 0.6 } } : undefined) } }),
}));
vi.mock("@/shared/rpc/operations", () => ({ getCodeBlocks: vi.fn(() => Promise.resolve({ blocks: [] })) }));

const { SelectionActions } = await import("./SelectionActions");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  created.length = 0;
  createAnnotation.mockClear();
  clear.mockClear();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/metin.pdf", null);
  usePreferencesStore.setState({ selectionToolbar: true });
});

afterEach(cleanup);

async function openToolbar() {
  const containerRef = createRef<HTMLDivElement>();
  render(
    <div ref={containerRef}>
      <SelectionActions documentId={DOCUMENT_ID} containerRef={containerRef} />
    </div>,
  );
  fireEvent.pointerUp(containerRef.current as HTMLDivElement, { clientX: 40, clientY: 30 });
  await act(async () => {
    endSelection?.();
    await Promise.resolve();
  });
  return screen.findByRole("toolbar");
}

describe("SelectionActions", () => {
  it("highlights the selection in one click with the highlighter colour and closes", async () => {
    await openToolbar();

    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: PdfAnnotationSubtype.HIGHLIGHT, color: "#FFD400", opacity: 0.6, pageIndex: 0 });
    expect(clear).toHaveBeenCalled();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("offers underline, strikethrough and squiggly behind the chevron", async () => {
    await openToolbar();
    fireEvent.click(screen.getByRole("button", { name: "More text marks" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Squiggly" }));

    expect(created[0]).toMatchObject({ type: PdfAnnotationSubtype.SQUIGGLY });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("closes the markup menu on Escape without closing the toolbar", async () => {
    await openToolbar();
    fireEvent.click(screen.getByRole("button", { name: "More text marks" }));

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("toolbar")).toBeTruthy();
    expect(createAnnotation).not.toHaveBeenCalled();
  });
});
