import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const imagePreview = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({ imagePreview: (...args: unknown[]) => imagePreview(...args) }));

import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { imageChangeFromBlock, placedAspect, replaceImageAt } from "./imageReplace";

describe("placedAspect", () => {
  it("keeps the picture aspect for an upright placement", () => {
    expect(placedAspect(600, 450, 0)).toBeCloseTo(4 / 3);
    expect(placedAspect(600, 450, 180)).toBeCloseTo(4 / 3);
  });

  it("swaps the aspect when the original placement is turned a quarter", () => {
    expect(placedAspect(600, 450, 90)).toBeCloseTo(3 / 4);
    expect(placedAspect(600, 450, 270)).toBeCloseTo(3 / 4);
  });
});

describe("replaceImageAt", () => {
  const block = { id: "img0", kind: "image" as const, bbox: [10, 10, 110, 60] as [number, number, number, number], xref: 7, placementRotation: 0 };
  const preview = { pngBase64: "AA", width: 200, height: 100 };

  it("replaces the picture and snapshots once when the target is still there", async () => {
    imagePreview.mockResolvedValue(preview);
    const item = imageChangeFromBlock(block as never, 0);
    useViewerOverlayStore.setState({ objects: [item as EditorPending], past: [], future: [] });
    await replaceImageAt(item, "x.png");
    const state = useViewerOverlayStore.getState();
    expect(state.past).toHaveLength(1);
    expect(state.objects[0].kind === "imageChange" && state.objects[0].replacement?.path).toBe("x.png");
  });

  it("does nothing when the target was deleted while the preview loaded", async () => {
    imagePreview.mockResolvedValue(preview);
    const item = imageChangeFromBlock(block as never, 0);
    useViewerOverlayStore.setState({ objects: [item as EditorPending], past: [], future: [] });
    const pending = replaceImageAt(item, "x.png");
    useViewerOverlayStore.setState({ objects: [] });
    await pending;
    expect(useViewerOverlayStore.getState().past).toHaveLength(0);
  });

  it("does nothing when the editing session ended while the preview loaded", async () => {
    imagePreview.mockResolvedValue(preview);
    const item = imageChangeFromBlock(block as never, 0);
    useViewerOverlayStore.setState({ objects: [item as EditorPending], past: [], future: [] });
    const pending = replaceImageAt(item, "x.png");
    useViewerOverlayStore.setState({ sessionToken: useViewerOverlayStore.getState().sessionToken + 1 });
    await pending;
    expect(useViewerOverlayStore.getState().past).toHaveLength(0);
  });
});
