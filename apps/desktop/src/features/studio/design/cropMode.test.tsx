import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioImageElement } from "@/types/studio";
import { createDesign, createImage } from "../model/design";
import { addElements } from "../model/edit";
import { CropBar, CropFrame } from "./CropOverlay";
import { applyCrop, beginCrop, cancelCrop, updateDraft, useCropStore } from "./cropMode";
import { moveDraft } from "./cropMath";
import { useStudioStore } from "./studioStore";
import { useStudioShortcuts } from "./useStudioShortcuts";

vi.mock("./assets", () => ({
  loadImagePreview: vi.fn(async () => ({ url: "blob:photo", width: 400, height: 200 })),
  useImagePreview: () => ({ status: "ready", value: { url: "blob:photo", width: 400, height: 200 } }),
}));

function image(): StudioImageElement {
  return useStudioStore.getState().design?.pages[0].elements[0] as StudioImageElement;
}

function press(key: string, options: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  });
}

describe("image crop mode", () => {
  beforeEach(() => {
    const design = createDesign("Crop", 400, 400);
    const page = addElements(design.pages[0], [createImage("C:/photo.png", 10, 20, 100, 100)]);
    useStudioStore.getState().open({ ...design, pages: [page] });
    useStudioStore.getState().select([page.elements[0].id]);
  });

  afterEach(() => {
    cleanup();
    cancelCrop();
    useStudioStore.getState().close();
  });

  it("applies a repositioned picture as one undo step", async () => {
    expect(await beginCrop()).toBe(true);

    updateDraft((draft) => moveDraft(draft, { x: 50, y: 0 }));
    applyCrop();

    expect(useCropStore.getState().session).toBeNull();
    expect(image()).toMatchObject({ fit: "cover", crop: { x: 0, y: 0, width: 0.5, height: 1 } });
    expect(useStudioStore.getState().past).toHaveLength(1);
    useStudioStore.getState().undo();
    expect(image().crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("leaves the design untouched when cancelled or applied without changes", async () => {
    await beginCrop();
    cancelCrop();
    await beginCrop();
    updateDraft((draft) => moveDraft(draft, { x: 0, y: 0 }));
    applyCrop();

    expect(useStudioStore.getState().past).toHaveLength(1);
    expect(image()).toMatchObject({ crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
  });

  it("refuses locked, empty or missing pictures", async () => {
    useStudioStore.getState().applyToPage((page) => ({ ...page, elements: page.elements.map((element) => ({ ...element, locked: true })) }));

    expect(await beginCrop()).toBe(false);
    expect(await beginCrop(createImage("", 0, 0, 10, 10))).toBe(false);
    useStudioStore.getState().select([]);
    expect(await beginCrop()).toBe(false);
    expect(useCropStore.getState().session).toBeNull();
  });

  it("starts with Enter, moves with arrows, and applies with Enter while other shortcuts wait", async () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    render(<CropFrame zoom={1} />);

    press("Enter");
    await waitFor(() => expect(useCropStore.getState().session).not.toBeNull());
    press("Delete");
    press("ArrowRight", { shiftKey: true });
    press("Enter");

    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(1);
    expect(image().crop.x).toBeCloseTo(0.2);
    expect(useCropStore.getState().session).toBeNull();
  });

  it("cancels with Escape and when the picture is deselected", async () => {
    render(
      <>
        <CropFrame zoom={1} />
        <CropBar />
      </>,
    );
    await act(async () => {
      await beginCrop();
    });

    expect(screen.getByTestId("studio-crop-frame")).toBeTruthy();
    expect(screen.getByRole("toolbar")).toBeTruthy();
    press("Escape");
    expect(useCropStore.getState().session).toBeNull();

    await act(async () => {
      await beginCrop();
    });
    act(() => useStudioStore.getState().select([]));
    expect(useCropStore.getState().session).toBeNull();
    expect(useStudioStore.getState().past).toHaveLength(0);
  });
});
