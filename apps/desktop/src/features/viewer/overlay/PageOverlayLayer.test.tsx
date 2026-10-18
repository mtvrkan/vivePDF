import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";

vi.mock("@/shared/rpc/operations", () => ({ editorBlocks: vi.fn(() => Promise.resolve({ blocks: [] })), imageAt: vi.fn(), imagePreview: vi.fn() }));

const { PageOverlayLayer } = await import("./PageOverlayLayer");

const IMAGE: EditorPending = { id: "picture", kind: "image", pageIndex: 0, x: 100, y: 100, width: 100, height: 100, dataUrl: "data:image/png;base64,AA", path: null, aspect: 1, opacity: 1 };

function layer(): HTMLElement {
  return document.querySelector<HTMLElement>(".select-none.z-20") as HTMLElement;
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useViewerOverlayStore.getState().setMode(null);
  useViewerOverlayStore.setState({ objects: [], selectedObjectId: null, editingObjectId: null });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PageOverlayLayer", () => {
  it("renders nothing while no editing mode is on", () => {
    render(<PageOverlayLayer documentId="doc" pageIndex={0} width={400} height={400} />);

    expect(layer()).toBeNull();
  });

  it("shows the move cursor over a placed picture and the default one beside it", () => {
    useViewerOverlayStore.getState().setMode("image");
    useViewerOverlayStore.setState({ objects: [IMAGE], selectedObjectId: null });
    render(<PageOverlayLayer documentId="doc" pageIndex={0} width={400} height={400} />);

    fireEvent.mouseMove(layer(), { clientX: 150, clientY: 150 });
    const over = layer().style.cursor;
    fireEvent.mouseMove(layer(), { clientX: 350, clientY: 350 });

    expect(over).toBe("move");
    expect(layer().style.cursor).toBe("default");
  });

  it("forgets the hovered picture when the pointer leaves the page", () => {
    useViewerOverlayStore.getState().setMode("image");
    useViewerOverlayStore.setState({ objects: [IMAGE], selectedObjectId: null });
    render(<PageOverlayLayer documentId="doc" pageIndex={0} width={400} height={400} />);

    fireEvent.mouseMove(layer(), { clientX: 150, clientY: 150 });
    fireEvent.mouseLeave(layer());

    expect(layer().style.cursor).toBe("default");
  });
});
