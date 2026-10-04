import { beforeEach, describe, expect, it, vi } from "vitest";
import { studioRender } from "@/shared/rpc/operations";
import type { StudioDesign, StudioRenderParams } from "@/types/studio";
import { addElements } from "../model/edit";
import { createDesign, createPage, createShape } from "../model/design";
import { chosenDesign, exportDesign, type ExportParams } from "./exportDesign";

vi.mock("@/shared/rpc/operations", () => ({
  studioRender: vi.fn(async () => ({ output: "out", outputs: ["out"], pageCount: 1, bytes: 1, missingGlyphs: "" })),
}));
vi.mock("./measure", () => ({ measureTexts: vi.fn(async () => new Map()) }));
vi.mock("./projectFile", () => ({ projectAssets: () => [] }));

function threePages(): StudioDesign {
  const design = createDesign("Cards", 100, 100);
  const pages = [design.pages[0], createPage(100, 100), createPage(100, 100)].map((page, index) => addElements(page, [createShape("rect", index, 0, 10, 10)]));
  return { ...design, pages };
}

const base: ExportParams = { output: "C:/out/cards.png", format: "png", dpi: 150, language: "en", title: "Cards", embed: true };

function sent(): StudioRenderParams {
  return vi.mocked(studioRender).mock.calls.at(-1)?.[0] as StudioRenderParams;
}

describe("exportDesign", () => {
  beforeEach(() => vi.mocked(studioRender).mockClear());

  it("sends only the chosen pages and names pictures after them", async () => {
    const design = threePages();

    await exportDesign({ ...base, pages: [3, 1], quality: 60 }, undefined, design);

    expect(sent().pages).toHaveLength(2);
    expect(sent().pageNumbers).toEqual([3, 1]);
    expect(sent().quality).toBe(60);
    expect(sent().embed).toBeNull();
  });

  it("paints white backgrounds only for see-through PNG and never for JPG or PDF", async () => {
    const design = threePages();

    await exportDesign({ ...base, transparent: true }, undefined, design);
    expect(sent().transparent).toBe(true);
    expect(sent().pages[0].items[0]).toMatchObject({ kind: "vector", paths: [{ fill: { type: "solid", color: "#ffffff" } }] });

    await exportDesign({ ...base, format: "jpg", transparent: true }, undefined, design);
    expect(sent().transparent).toBe(false);
    expect(sent().pages[0].items).toHaveLength(1);

    await exportDesign({ ...base, format: "pdf", output: "C:/out/cards.pdf", transparent: true, pages: [2] }, undefined, design);
    expect(sent().transparent).toBe(false);
    expect(sent().pageNumbers).toBeNull();
    expect(sent().embed?.design.pages).toHaveLength(1);
  });

  it("keeps the whole design when every page is chosen or the choice is empty", () => {
    const design = threePages();

    expect(chosenDesign(design, [1, 2, 3])).toEqual({ design, numbers: null });
    expect(chosenDesign(design, [])).toEqual({ design, numbers: null });
    expect(chosenDesign(design, [0, 9, 2]).numbers).toEqual([2]);
  });

  it("refuses to export without a design", async () => {
    await expect(exportDesign(base)).rejects.toThrow("no design");
  });
});
