import { describe, expect, it } from "vitest";
import type { LayerRow } from "@/types";
import { chooseLayer, hasLayers, layerChoiceList, layerShown, useLayerViewStore } from "./layerViewStore";

const base: LayerRow = { id: 5, name: "Base", depth: 0, kind: "layer", on: true, locked: false };
const hidden: LayerRow = { id: 7, name: "Hidden", depth: 1, kind: "layer", on: false, locked: false };
const label: LayerRow = { id: null, name: "Review", depth: 0, kind: "label", on: false, locked: false };

describe("layer choices", () => {
  it("shows the document's own state until a layer is switched", () => {
    expect(layerShown(base, undefined)).toBe(true);
    expect(layerShown(hidden, {})).toBe(false);
    expect(layerShown(hidden, { 7: true })).toBe(true);
    expect(layerShown(label, { 5: true })).toBe(false);
  });

  it("keeps only the layers that differ from the document", () => {
    const rows = [base, hidden];
    const switched = chooseLayer(rows, undefined, 5, false);
    expect(switched).toEqual({ 5: false });
    expect(chooseLayer(rows, switched, 5, true)).toEqual({});
    expect(layerChoiceList(chooseLayer(rows, switched, 7, true))).toEqual([
      { id: 5, on: false },
      { id: 7, on: true },
    ]);
  });

  it("offers the panel only when a real layer is listed", () => {
    expect(hasLayers(undefined)).toBe(false);
    expect(hasLayers({ state: "loading" })).toBe(false);
    expect(hasLayers({ state: "listed", rows: [label] })).toBe(false);
    expect(hasLayers({ state: "listed", rows: [label, base] })).toBe(true);
  });
});

describe("useLayerViewStore", () => {
  it("drops a path's choices when none remain and forgets lists per document", () => {
    const store = useLayerViewStore.getState();
    store.setChoices("a.pdf", { 5: false });
    expect(useLayerViewStore.getState().choices["a.pdf"]).toEqual({ 5: false });
    store.setChoices("a.pdf", {});
    expect("a.pdf" in useLayerViewStore.getState().choices).toBe(false);
    store.setList("doc", { state: "loading" });
    store.forgetList("doc");
    expect(useLayerViewStore.getState().lists.doc).toBeUndefined();
    const before = useLayerViewStore.getState().choices;
    store.clearChoices("absent.pdf");
    expect(useLayerViewStore.getState().choices).toBe(before);
  });
});
