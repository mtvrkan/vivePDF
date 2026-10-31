import { describe, expect, it } from "vitest";
import { drawKeyAction } from "./drawKeys";

const press = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe("drawKeyAction", () => {
  it("undoes and redoes with Ctrl or Cmd, Z, Shift+Z and Ctrl+Y", () => {
    const actions = [press("z", { ctrlKey: true }), press("Z", { metaKey: true, shiftKey: true }), press("y", { ctrlKey: true })].map((key) => drawKeyAction(key, false));

    expect(actions).toEqual(["undo", "redo", "redo"]);
  });

  it("deletes the selection with Delete or Backspace and puts the tool down with Escape", () => {
    const actions = [press("Delete"), press("Backspace"), press("Escape")].map((key) => drawKeyAction(key, false));

    expect(actions).toEqual(["remove", "remove", "dropTool"]);
  });

  it("leaves keys alone while typing in a note or with Alt or other letters held", () => {
    const actions = [drawKeyAction(press("Backspace"), true), drawKeyAction(press("z", { ctrlKey: true }), true), drawKeyAction(press("z", { ctrlKey: true, altKey: true }), false), drawKeyAction(press("a"), false)];

    expect(actions).toEqual([null, null, null, null]);
  });
});
