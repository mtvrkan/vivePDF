import { describe, expect, it } from "vitest";
import type { FormField } from "@/types";
import { changedValues, emptyRequired, initialValues, optionLabel } from "./fillValues";

function field(overrides: Partial<FormField>): FormField {
  return { name: "f", kind: "text", page: 1, value: null, options: [], label: null, readOnly: false, required: false, multiline: false, rect: [0, 0, 1, 1], ...overrides };
}

describe("initialValues", () => {
  it("keeps a radio group's chosen state as text and an unchosen group as empty", () => {
    const values = initialValues([field({ name: "size", kind: "radio", value: "M", options: ["S", "M"] }), field({ name: "tone", kind: "radio", value: null, options: ["A"] })]);
    expect(values).toEqual({ size: "M", tone: "" });
  });

  it("reads checkboxes as booleans and multi-select lists as arrays", () => {
    const values = initialValues([field({ name: "ok", kind: "checkbox", value: true }), field({ name: "tags", kind: "listbox", multiSelect: true, value: ["a"] })]);
    expect(values).toEqual({ ok: true, tags: ["a"] });
  });

  it("leaves buttons and signatures out", () => {
    expect(initialValues([field({ name: "sig", kind: "signature" }), field({ name: "go", kind: "button" })])).toEqual({});
  });
});

describe("changedValues", () => {
  const fields = [field({ name: "a" }), field({ name: "b" }), field({ name: "tags", kind: "listbox", multiSelect: true })];

  it("sends only the fields the user changed", () => {
    expect(changedValues(fields, { a: "x", b: "y", tags: ["1"] }, { a: "x", b: "z", tags: ["1"] })).toEqual({ b: "z" });
  });

  it("compares lists by their items", () => {
    expect(changedValues(fields, { tags: ["1"] }, { tags: ["1", "2"] })).toEqual({ tags: ["1", "2"] });
  });

  it("sends a cleared value so the field is emptied", () => {
    expect(changedValues(fields, { a: "x" }, { a: "" })).toEqual({ a: "" });
  });
});

describe("emptyRequired", () => {
  it("lists required fields that are still blank", () => {
    const fields = [field({ name: "a", required: true }), field({ name: "b", required: true }), field({ name: "c" })];
    expect(emptyRequired(fields, { a: "  ", b: "ok", c: "" }).map((item) => item.name)).toEqual(["a"]);
  });
});

describe("optionLabel", () => {
  it("shows the display text of an option and falls back to its value", () => {
    const combo = field({ kind: "combobox", options: ["tr", "de"], optionLabels: ["Türkiye", ""] });
    expect(optionLabel(combo, "tr")).toBe("Türkiye");
    expect(optionLabel(combo, "de")).toBe("de");
    expect(optionLabel(combo, "fr")).toBe("fr");
  });
});
