import { afterEach, describe, expect, it } from "vitest";
import { pendingChangesFor, usePendingChangesStore, type PendingChange } from "@/shared/store/pendingChangesStore";
import { canDeletePage, NO_PAGE_EDITS, normalizedTurn, orderedForSave, pageEditCount, pageRotation, pageTurns, pendingPageEdits, rotatePage, storePageEdits, toggleDeleted } from "./pageEdits";

const DOCUMENT = "doc-1";

describe("pageEdits", () => {
  afterEach(() => usePendingChangesStore.getState().clear(DOCUMENT));

  it("marks a page deleted and restores it on the second toggle", () => {
    const marked = toggleDeleted(NO_PAGE_EDITS, 2, 5);

    expect(marked?.deleted).toEqual([2]);
    expect(toggleDeleted(marked!, 2, 5)?.deleted).toEqual([]);
  });

  it("refuses to delete the last remaining page", () => {
    const edits = { deleted: [0, 1], rotations: {} };

    expect(toggleDeleted(edits, 2, 3)).toBeNull();
    expect(canDeletePage(edits, 2, 3)).toBe(false);
    expect(canDeletePage(edits, 1, 3)).toBe(true);
  });

  it("rotates in quarter turns and forgets a full turn", () => {
    const right = rotatePage(NO_PAGE_EDITS, 1, 90);
    const back = rotatePage(right, 1, -90);
    const left = rotatePage(NO_PAGE_EDITS, 1, -90);

    expect(pageRotation(right, 1)).toBe(90);
    expect(back.rotations).toEqual({});
    expect(pageRotation(left, 1)).toBe(270);
    expect(normalizedTurn(-450)).toBe(270);
  });

  it("counts and sends only rotations of kept pages", () => {
    const edits = { deleted: [0], rotations: { 0: 90, 3: 180 } };

    expect(pageEditCount(edits)).toBe(2);
    expect(pageTurns(edits)).toEqual([{ page: 3, rotate: 180 }]);
  });

  it("stores one change per document and drops it when the last edit is undone", () => {
    storePageEdits(DOCUMENT, { deleted: [1], rotations: {} }, "Pages");
    storePageEdits(DOCUMENT, { deleted: [1, 2], rotations: {} }, "Pages");
    const queued = pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT);

    expect(queued).toHaveLength(1);
    expect(pendingPageEdits(queued)?.deleted).toEqual([1, 2]);

    storePageEdits(DOCUMENT, NO_PAGE_EDITS, "Pages");

    expect(pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT)).toHaveLength(0);
  });

  it("saves page edits after every other change", () => {
    const pages = { id: "p", kind: "pagesEdited", deleted: [0], rotations: {}, label: "Pages" } as PendingChange;
    const outline = { id: "o", kind: "outlineReplaced", items: [], label: "Outline" } as PendingChange;
    const form = { id: "f", kind: "formFilled", values: {}, label: "Form" } as PendingChange;

    expect(orderedForSave([pages, outline, form]).map((change) => change.id)).toEqual(["o", "f", "p"]);
  });
});
