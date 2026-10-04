import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign } from "../model/design";
import { fittedSize, insertImagePaths, isImagePath, pasteImageFiles, placedAt } from "./imageImport";
import { useStudioStore } from "./studioStore";

const operations = vi.hoisted(() => ({
  studioSaveImage: vi.fn<(params: { data: string }) => Promise<{ path: string; width: number; height: number }>>(async () => ({ path: "C:/data/studio-images/abc.png", width: 200, height: 100 })),
  studioImportSvg: vi.fn<(params: { path: string }) => Promise<{ svg: string; width: number; height: number }>>(async () => ({ svg: "<svg/>", width: 50, height: 100 })),
}));

vi.mock("@/shared/rpc/operations", () => operations);
vi.mock("./assets", () => ({ loadImagePreview: vi.fn(async (path: string) => (path.includes("broken") ? null : { url: "blob:x", width: 200, height: 100 })) }));

describe("image import", () => {
  beforeEach(() => {
    useStudioStore.getState().open(createDesign("Drop", 400, 300));
    operations.studioSaveImage.mockClear();
  });

  afterEach(() => {
    useStudioStore.getState().close();
  });

  it("recognises dropped pictures by extension and leaves PDFs alone", () => {
    expect(isImagePath("C:/a/Photo.PNG")).toBe(true);
    expect(isImagePath("/x/logo.svg")).toBe(true);
    expect(isImagePath("C:/a/report.pdf")).toBe(false);
    expect(isImagePath("C:/a/noextension")).toBe(false);
  });

  it("sizes pictures to half the page and centres them on the drop point", () => {
    expect(fittedSize({ width: 400, height: 300 }, 2)).toEqual({ width: 200, height: 100 });
    expect(fittedSize({ width: 400, height: 300 }, 0.5)).toEqual({ width: 75, height: 150 });
    expect(fittedSize({ width: 400, height: 300 }, Number.NaN).width).toBe(200);
    expect(placedAt({ width: 400, height: 300 }, { width: 200, height: 100 }, null)).toEqual({ x: 100, y: 100 });
    expect(placedAt({ width: 400, height: 300 }, { width: 20, height: 10 }, { x: 50, y: 50 }, 2)).toEqual({ x: 72, y: 77 });
  });

  it("inserts dropped images and drawings in one undo step and selects them", async () => {
    const ids = await insertImagePaths(["C:/a/photo.jpg", "C:/a/logo.svg"], { x: 100, y: 100 });

    const state = useStudioStore.getState();
    const elements = state.design?.pages[0].elements ?? [];
    expect(elements.map((element) => element.kind)).toEqual(["image", "svg"]);
    expect(elements[0]).toMatchObject({ src: "C:/a/photo.jpg", x: 0, y: 50, width: 200, height: 100 });
    expect(state.selection).toEqual(ids);
    expect(state.past).toHaveLength(1);
  });

  it("reports pictures that cannot be read and still inserts the rest", async () => {
    const errors: unknown[] = [];
    operations.studioImportSvg.mockRejectedValueOnce({ code: "INVALID_PARAMS", message: "bad" });

    const ids = await insertImagePaths(["C:/a/bad.svg", "C:/a/broken.png", "C:/a/fine.png"], null, (error) => errors.push(error));

    expect(ids).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(useStudioStore.getState().design?.pages[0].elements[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("saves pasted image bytes through the engine and inserts the stored file", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });

    await pasteImageFiles([file]);

    expect(operations.studioSaveImage).toHaveBeenCalledWith({ data: "iVBORw==" });
    expect(useStudioStore.getState().design?.pages[0].elements[0]).toMatchObject({ kind: "image", src: "C:/data/studio-images/abc.png" });
  });

  it("inserts nothing when the engine refuses the pasted data", async () => {
    const errors: unknown[] = [];
    operations.studioSaveImage.mockRejectedValueOnce({ code: "INVALID_PARAMS", message: "no", data: { reason: "imageUnreadable" } });

    const ids = await pasteImageFiles([new File(["x"], "x.png", { type: "image/png" })], (error) => errors.push(error));

    expect(ids).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(0);
  });
});
