import { afterEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "../model/design";
import { groupElements } from "../model/layers";
import { useStudioStore } from "./studioStore";

function openPage() {
  const page = createPage(500, 400);
  page.elements = [0, 1, 2].map((index) => ({ ...createShape("rect", index * 20, 0, 10, 10), id: `e${index}` }));
  useStudioStore.getState().open({ ...createDesign("Card", 500, 400), pages: [groupElements(page, ["e1", "e2"]).page] });
}

afterEach(() => useStudioStore.getState().close());

describe("studio selection", () => {
  it("keeps the same selection list when the same items are picked again", () => {
    openPage();
    useStudioStore.getState().select(["e0"]);
    const before = useStudioStore.getState().selection;

    useStudioStore.getState().select(["e0"]);

    expect(useStudioStore.getState().selection).toBe(before);
  });

  it("hands out a new list when the picked items change", () => {
    openPage();
    useStudioStore.getState().select(["e0"]);
    const before = useStudioStore.getState().selection;

    useStudioStore.getState().select(["e1"]);

    expect(useStudioStore.getState().selection).not.toBe(before);
    expect(useStudioStore.getState().selection).toEqual(["e1", "e2"]);
  });

  it("clears to an empty list without a page", () => {
    useStudioStore.getState().select(["e0"]);

    expect(useStudioStore.getState().selection).toEqual([]);
  });
});
