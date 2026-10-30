import { describe, expect, it } from "vitest";
import { viewerKeyAction } from "./viewerKeys";

const press = (key: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

describe("viewerKeyAction", () => {
  it("maps the command shortcuts on Windows and Mac", () => {
    const actions = [press("f", { ctrlKey: true }), press("F", { metaKey: true }), press("=", { metaKey: true }), press("-", { ctrlKey: true }), press("0", { ctrlKey: true }), press("c", { metaKey: true })].map((event) => viewerKeyAction(event, false));

    expect(actions).toEqual(["search", "search", "zoomIn", "zoomOut", "fitWidth", "copy"]);
  });

  it("jumps to the first and last page with Home and End", () => {
    const actions = [viewerKeyAction(press("Home"), false), viewerKeyAction(press("End"), false)];

    expect(actions).toEqual(["firstPage", "lastPage"]);
  });

  it("leaves typing alone except for opening search", () => {
    const actions = [viewerKeyAction(press("Home"), true), viewerKeyAction(press("c", { ctrlKey: true }), true), viewerKeyAction(press("f", { ctrlKey: true }), true)];

    expect(actions).toEqual([null, null, "search"]);
  });

  it("ignores AltGr combinations and plain letters", () => {
    const actions = [viewerKeyAction(press("f", { ctrlKey: true, altKey: true }), false), viewerKeyAction(press("a"), false)];

    expect(actions).toEqual([null, null]);
  });
});
