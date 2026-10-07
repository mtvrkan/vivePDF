import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "@embedpdf/models";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";

const DOCUMENT_ID = "doc-context";
const selectionRects: Record<string, Array<{ origin: { x: number; y: number }; size: { width: number; height: number } }>> = {};
const created: PdfAnnotationObject[] = [];
const createAnnotation = vi.fn((_pageIndex: number, object: PdfAnnotationObject) => created.push(object));
const clear = vi.fn();

const scope = {
  getSelectedText: () => ({ toPromise: () => Promise.resolve(Object.keys(selectionRects).length > 0 ? ["marked words"] : []) }),
  getHighlightRects: () => selectionRects,
  clear,
};

vi.mock("@embedpdf/plugin-selection/react", () => ({ useSelectionCapability: () => ({ provides: { forDocument: () => scope } }) }));
vi.mock("@embedpdf/plugin-rotate/react", () => ({ useRotate: () => ({ provides: null, rotation: 0 }) }));
vi.mock("@embedpdf/plugin-zoom/react", () => ({ useZoomCapability: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-annotation/react", () => ({
  useAnnotation: () => ({ provides: { createAnnotation } }),
  useAnnotationCapability: () => ({ provides: { getTool: (toolId: string) => (toolId === "underline" ? { defaults: { strokeColor: "#E5484D" } } : undefined) } }),
}));
vi.mock("./usePageNavigation", () => ({ usePageNavigation: () => ({ jumpTo: vi.fn() }) }));
vi.mock("@/shared/rpc/operations", () => ({
  imageAt: vi.fn(() => Promise.resolve({ found: false })),
  assemblePages: vi.fn(),
  convertToImages: vi.fn(),
  getCodeBlocks: vi.fn(),
  imageSave: vi.fn(),
}));
vi.mock("@/shared/rpc/files", async (importOriginal) => ({ ...(await importOriginal<object>()), openProducedPicture: vi.fn(), searchPictureWithLens: vi.fn() }));
vi.mock("@/shared/rpc/thumbnail", () => ({ renderThumbnail: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ join: vi.fn(), tempDir: vi.fn() }));

const { ViewerContextMenu } = await import("./ViewerContextMenu");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  created.length = 0;
  createAnnotation.mockClear();
  clear.mockClear();
  for (const key of Object.keys(selectionRects)) delete selectionRects[key];
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/menu.pdf", null);
});

afterEach(cleanup);

async function openMenu(readOnlySource?: { path: string; password: string | null }) {
  const hostRef = createRef<HTMLDivElement>();
  render(
    <div ref={hostRef}>
      <div data-page-index="0" data-testid="page" />
      <ViewerContextMenu documentId={DOCUMENT_ID} hostRef={hostRef} readOnlySource={readOnlySource} />
    </div>,
  );
  const page = screen.getByTestId("page");
  page.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  await act(async () => {
    fireEvent.contextMenu(page, { clientX: 20, clientY: 22 });
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ViewerContextMenu text marks", () => {
  it("offers highlight, underline and strikethrough when text is selected", async () => {
    selectionRects["0"] = [{ origin: { x: 10, y: 20 }, size: { width: 40, height: 8 } }];

    await openMenu();

    expect(screen.getByRole("menuitem", { name: "Highlight" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Underline" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Strikeout" })).toBeTruthy();
  });

  it("underlines the selection with the underline tool colour", async () => {
    selectionRects["0"] = [{ origin: { x: 10, y: 20 }, size: { width: 40, height: 8 } }];
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Underline" }));

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: PdfAnnotationSubtype.UNDERLINE, strokeColor: "#E5484D", pageIndex: 0 });
    expect(clear).toHaveBeenCalled();
  });

  it("leaves the marks out without a text selection", async () => {
    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "Highlight" })).toBeNull();
  });

  it("leaves the marks out in the read-only pane", async () => {
    selectionRects["0"] = [{ origin: { x: 10, y: 20 }, size: { width: 40, height: 8 } }];

    await openMenu({ path: "C:/belgeler/menu.pdf", password: null });

    expect(screen.getByRole("menuitem", { name: "Copy text" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Highlight" })).toBeNull();
  });
});
