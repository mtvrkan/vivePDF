import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";

const annotation = vi.hoisted(() => ({ state: { activeToolId: null as string | null } }));
const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
const Empty = () => null;

vi.mock("@embedpdf/plugin-viewport/react", () => ({ Viewport: Pass }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({
  Scroller: ({ renderPage }: { renderPage: (page: { width: number; height: number; pageIndex: number }) => ReactNode }) => <>{renderPage({ width: 100, height: 100, pageIndex: 0 })}</>,
}));
vi.mock("@embedpdf/plugin-render/react", () => ({ RenderLayer: Empty }));
vi.mock("@embedpdf/plugin-tiling/react", () => ({ TilingLayer: Empty }));
vi.mock("@embedpdf/plugin-search/react", () => ({ SearchLayer: Empty }));
vi.mock("@embedpdf/plugin-selection/react", () => ({ SelectionLayer: Empty }));
vi.mock("@embedpdf/plugin-annotation/react", () => ({ AnnotationLayer: Empty, useAnnotation: () => ({ provides: null, state: annotation.state }) }));
vi.mock("@embedpdf/plugin-redaction/react", () => ({ RedactionLayer: Empty }));
vi.mock("@embedpdf/plugin-rotate/react", () => ({ Rotate: Pass }));
vi.mock("@embedpdf/plugin-interaction-manager/react", () => ({ GlobalPointerProvider: Pass, PagePointerProvider: Pass }));
vi.mock("@embedpdf/plugin-pan/react", () => ({ PanMode: Empty }));
vi.mock("@embedpdf/plugin-zoom/react", () => ({ MarqueeZoom: Empty, ZoomGestureWrapper: Pass }));
vi.mock("./PageBitmap", () => ({ PageBitmap: Pass }));
vi.mock("./PageSkeleton", () => ({ PageSkeleton: Empty }));
vi.mock("./PageTextLayer", () => ({ PageTextLayer: Empty }));
vi.mock("./FieldHighlights", () => ({ FieldHighlights: Empty }));
vi.mock("./overlay/PageOverlayLayer", () => ({ PageOverlayLayer: Empty }));
vi.mock("./forms/FormFieldLayer", () => ({ FormFieldLayer: Empty }));
vi.mock("./forms/FormXfaNotice", () => ({ FormXfaNotice: Empty }));
vi.mock("./PageEditLayer", () => ({ PageEditLayer: Empty }));
vi.mock("./MarkToolLayer", () => ({ MarkToolLayer: Empty }));
vi.mock("./LinkPreview", () => ({ LinkPreview: Empty }));
vi.mock("./ViewerContextMenu", () => ({ ViewerContextMenu: Empty }));
vi.mock("./ZoomBadge", () => ({ ZoomBadge: Empty }));
vi.mock("./useViewportPan", () => ({ useViewportPan: () => undefined }));
vi.mock("./useWheelZoom", () => ({ useWheelZoom: () => undefined }));
vi.mock("./useSelectionRelease", () => ({ useSelectionRelease: () => undefined }));

const { PageView } = await import("./PageView");

function host(): HTMLElement {
  return document.querySelector<HTMLElement>(".relative.h-full") as HTMLElement;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  annotation.state = { activeToolId: null };
});

describe("PageView", () => {
  it("shows the pen cursor on the pages while the ink tool is on", () => {
    annotation.state = { activeToolId: "ink" };
    render(<PageView documentId="doc" />);

    expect(host().hasAttribute("data-draw-cursor")).toBe(true);
    expect(host().style.cursor).toContain("data:image/svg+xml");
  });

  it("keeps the plain cursor for other annotation tools", () => {
    annotation.state = { activeToolId: "square" };
    render(<PageView documentId="doc" />);

    expect(host().hasAttribute("data-draw-cursor")).toBe(false);
    expect(host().style.cursor).toBe("");
  });

  it("takes the pen cursor away again when the ink tool goes off", () => {
    annotation.state = { activeToolId: "ink" };
    const { rerender } = render(<PageView documentId="doc" />);

    annotation.state = { activeToolId: null };
    rerender(<PageView documentId="doc" />);

    expect(host().hasAttribute("data-draw-cursor")).toBe(false);
    expect(host().style.cursor).toBe("");
  });
});
