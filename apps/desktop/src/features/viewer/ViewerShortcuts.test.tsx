import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";

const scroll = { scrollToNextPage: vi.fn(), scrollToPreviousPage: vi.fn(), scrollToPage: vi.fn() };

vi.mock("@embedpdf/plugin-annotation/react", () => ({ useAnnotation: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-history/react", () => ({ useHistoryCapability: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-redaction/react", () => ({ useRedaction: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-selection/react", () => ({ useSelectionCapability: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ provides: scroll, state: { currentPage: 1, totalPages: 3 } }) }));
vi.mock("@embedpdf/plugin-zoom/react", () => ({
  ZoomMode: { FitWidth: "fit-width", FitPage: "fit-page" },
  useZoom: () => ({ provides: null, state: { isMarqueeZoomActive: false } }),
}));

const { ViewerShortcuts } = await import("./ViewerShortcuts");

function press(key: string, init: KeyboardEventInit = {}, target: Element | Window = window) {
  fireEvent.keyDown(target, { key, ...init });
}

function openPresentationTools() {
  useViewerPanelsStore.getState().setPanels((panels) => ({ ...panels, present: true }));
}

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  useUiStore.setState({ immersive: false });
  useViewerPanelsStore.getState().setPanels((panels) => ({ ...panels, present: false, reading: false }));
  scroll.scrollToNextPage.mockClear();
});

afterEach(cleanup);

describe("ViewerShortcuts presentation keys", () => {
  it("switches presentation tools with letters while the presentation tools are open in the viewer", () => {
    openPresentationTools();
    render(<ViewerShortcuts documentId="doc" />);

    press("p");
    expect(usePresentationStore.getState().tool).toBe("pen");
    press("L");
    expect(usePresentationStore.getState().tool).toBe("laser");
    press("l");
    expect(usePresentationStore.getState().tool).toBe("pointer");
    press("з", { code: "KeyP" });
    expect(usePresentationStore.getState().tool).toBe("pen");
  });

  it("leaves letters alone in the plain viewer and keeps full-screen keys to full screen", () => {
    render(<ViewerShortcuts documentId="doc" />);

    press("p");
    expect(usePresentationStore.getState().tool).toBe("pointer");

    openPresentationTools();
    press("b");
    expect(usePresentationStore.getState().blackout).toBe("none");
  });

  it("keeps working after a style slider took the focus, without stealing the slider's arrows", () => {
    useUiStore.setState({ immersive: true });
    render(<ViewerShortcuts documentId="doc" />);
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);

    press("h", {}, slider);
    expect(usePresentationStore.getState().tool).toBe("highlighter");
    press("ArrowRight", {}, slider);
    expect(scroll.scrollToNextPage).not.toHaveBeenCalled();
    press("b", {}, slider);
    expect(usePresentationStore.getState().blackout).toBe("black");
    slider.remove();
  });

  it("ignores letters typed into a text field", () => {
    openPresentationTools();
    render(<ViewerShortcuts documentId="doc" />);
    const field = document.createElement("input");
    document.body.append(field);

    press("p", {}, field);

    expect(usePresentationStore.getState().tool).toBe("pointer");
    field.remove();
  });

  it("undoes and deletes drawings in the viewer's presentation tools", () => {
    openPresentationTools();
    usePresentationStore.getState().addStroke(0, { id: "a", tool: "pen", color: "#000000", width: 0.005, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
    usePresentationStore.getState().addStroke(0, { id: "b", tool: "pen", color: "#000000", width: 0.005, points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }] });
    render(<ViewerShortcuts documentId="doc" />);

    press("z", { ctrlKey: true });
    expect(usePresentationStore.getState().strokesByPage[0].map((stroke) => stroke.id)).toEqual(["a"]);

    usePresentationStore.getState().setTool("select");
    usePresentationStore.getState().selectDrawing({ surface: 0, id: "a" });
    press("Delete");
    expect(usePresentationStore.getState().strokesByPage[0]).toEqual([]);
  });
});
