import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserKeyGuard } from "@/shared/lib/browserKeys";
import { addElements } from "../model/edit";
import { createDesign, createShape } from "../model/design";
import { useStudioStore } from "./studioStore";
import { useStudioShortcuts } from "./useStudioShortcuts";

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...options }));
}

describe("studio shortcuts", () => {
  let removeGuard: () => void;

  beforeEach(() => {
    removeGuard = installBrowserKeyGuard(false);
    const design = createDesign("Card", 200, 100);
    const page = addElements(design.pages[0], [createShape("rect", 0, 0, 10, 10), createShape("ellipse", 20, 0, 10, 10)]);
    useStudioStore.getState().open({ ...design, pages: [page] });
    useStudioStore.getState().select(page.elements.map((element) => element.id));
  });

  afterEach(() => {
    removeGuard();
    useStudioStore.getState().close();
    document.body.innerHTML = "";
  });

  it("saves with Ctrl+S and Ctrl+Shift+S although the browser guard blocks those keys", () => {
    const onSave = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), onSave));

    press("s");
    press("S", { shiftKey: true });

    expect(onSave.mock.calls).toEqual([[false], [true]]);
  });

  it("saves even while the design name is being typed", () => {
    const onSave = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), onSave));
    const input = document.body.appendChild(document.createElement("input"));

    press("s", {}, input);

    expect(onSave).toHaveBeenCalledWith(false);
  });

  it("groups the selection with Ctrl+G but leaves keys alone while a dialog is open", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");

    press("g");
    expect(useStudioStore.getState().design?.pages[0].elements.map((element) => element.groupId)).toEqual([null, null]);

    dialog.remove();
    press("g");
    const groups = useStudioStore.getState().design?.pages[0].elements.map((element) => element.groupId);
    expect(groups?.[0]).toBeTruthy();
    expect(groups?.[0]).toBe(groups?.[1]);
  });
});
