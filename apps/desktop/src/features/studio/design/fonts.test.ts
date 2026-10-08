import { afterEach, describe, expect, it, vi } from "vitest";

const fontFile = vi.hoisted(() => vi.fn(async () => ({ ext: "pfb", base64: "", italic: false })));

vi.mock("@/shared/rpc/operations", () => ({ fontFile }));

const { ensureFace, faceKey, forgetFonts, useStudioFontsStore } = await import("./fonts");

afterEach(() => {
  forgetFonts(() => true);
  fontFile.mockClear();
});

describe("studio font faces", () => {
  it("publishes faces that finish together in one store update", async () => {
    const updates = vi.fn();
    const stop = useStudioFontsStore.subscribe(updates);

    await Promise.all([ensureFace("system:a", 400, false), ensureFace("system:b", 700, false)]);
    stop();

    expect(updates).toHaveBeenCalledTimes(1);
    expect(Object.keys(useStudioFontsStore.getState().faces).sort()).toEqual([faceKey("system:a", 400, false), faceKey("system:b", 700, false)]);
  });

  it("asks the engine once for a face that is already known", async () => {
    await ensureFace("system:a", 400, false);
    await ensureFace("system:a", 400, false);

    expect(fontFile).toHaveBeenCalledTimes(1);
  });

  it("remembers a face that could not be loaded as missing", async () => {
    fontFile.mockRejectedValueOnce(new Error("gone"));

    expect(await ensureFace("system:c", 400, false)).toBeNull();
    expect(useStudioFontsStore.getState().faces[faceKey("system:c", 400, false)]).toBeNull();
  });
});
