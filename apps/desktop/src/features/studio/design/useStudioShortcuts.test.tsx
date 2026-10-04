import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { installBrowserKeyGuard } from "@/shared/lib/browserKeys";
import { addElements } from "../model/edit";
import { createDesign, createShape, createText } from "../model/design";
import { useStudioStore } from "./studioStore";
import { useStyleClipboard } from "./styleClipboard";
import { useStudioShortcuts } from "./useStudioShortcuts";
import { DEFAULT_VIEW_PREFS, useViewPrefs } from "./viewPrefs";

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
    useStyleClipboard.setState({ style: null });
    document.body.innerHTML = "";
  });

  it("saves with Ctrl+S and Ctrl+Shift+S although the browser guard blocks those keys", () => {
    const onSave = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), onSave));

    press("s");
    press("S", { shiftKey: true });

    expect(onSave.mock.calls).toEqual([[false], [true]]);
  });

  it("opens printing with Ctrl+P although the browser guard blocks the WebView print", () => {
    const onPrint = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn(), { onPrint }));

    press("p");
    press("P", { shiftKey: true });

    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("does not open printing again while a dialog is open", () => {
    const onPrint = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn(), { onPrint }));
    document.body.appendChild(document.createElement("div")).setAttribute("role", "dialog");

    press("p");

    expect(onPrint).not.toHaveBeenCalled();
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

  it("toggles italic with the Turkish dotless ı key and saves while text is edited on the canvas", () => {
    const onSave = vi.fn();
    renderHook(() => useStudioShortcuts(vi.fn(), onSave));
    const state = useStudioStore.getState();
    const text = createText(0, 40, 100, 20, "Merhaba");
    state.applyToPage((page) => addElements(page, [text]));
    state.select([text.id]);

    press("ı", { code: "KeyI" });
    const editor = document.body.appendChild(document.createElement("div"));
    editor.contentEditable = "true";
    press("s", {}, editor);

    const italic = useStudioStore.getState().design?.pages[0].elements.find((element) => element.id === text.id);
    expect(italic?.kind === "text" && italic.italic).toBe(true);
    expect(onSave).toHaveBeenCalledWith(false);
  });

  it("changes layer order with Ctrl+arrow and the bracket key but ignores AltGr", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    const state = useStudioStore.getState();
    const [first, second] = state.design?.pages[0].elements ?? [];
    state.select([first.id]);

    press("[", { code: "Digit8", altKey: true });
    expect(useStudioStore.getState().design?.pages[0].elements.map((element) => element.id)).toEqual([first.id, second.id]);

    press("ArrowUp");
    expect(useStudioStore.getState().design?.pages[0].elements.map((element) => element.id)).toEqual([second.id, first.id]);

    press("ğ", { code: "BracketLeft" });
    expect(useStudioStore.getState().design?.pages[0].elements.map((element) => element.id)).toEqual([first.id, second.id]);
  });

  it("copies and pastes style with Ctrl+Alt+C and Ctrl+Alt+V by key position, but never while typing", () => {
    const { unmount } = renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    onTestFinished(unmount);
    const state = useStudioStore.getState();
    const [first, second] = state.design?.pages[0].elements ?? [];
    state.applyToPage((page) => ({ ...page, elements: page.elements.map((element) => (element.id === first.id ? { ...element, opacity: 0.4 } : element)) }));
    state.select([first.id]);

    press("c", { code: "KeyC", altKey: true });
    useStudioStore.getState().select([second.id]);
    const input = document.body.appendChild(document.createElement("input"));
    press("v", { code: "KeyV", altKey: true }, input);
    expect(useStudioStore.getState().design?.pages[0].elements[1].opacity).toBe(1);

    press("v", { code: "KeyV", altKey: true });
    expect(useStudioStore.getState().design?.pages[0].elements[1].opacity).toBe(0.4);
  });

  it("pastes in place with Ctrl+Shift+V and leaves Enter to a focused button", () => {
    const onExport = vi.fn();
    renderHook(() => useStudioShortcuts(onExport, vi.fn()));
    const state = useStudioStore.getState();
    const [first] = state.design?.pages[0].elements ?? [];
    state.select([first.id]);

    press("c");
    press("V", { shiftKey: true });
    const elements = useStudioStore.getState().design?.pages[0].elements ?? [];
    const button = document.body.appendChild(document.createElement("button"));
    const text = createText(0, 40, 100, 20, "Merhaba");
    useStudioStore.getState().applyToPage((page) => addElements(page, [text]));
    useStudioStore.getState().select([text.id]);
    press("Enter", { ctrlKey: false }, button);

    expect(elements).toHaveLength(3);
    expect(elements[2]).toMatchObject({ x: first.x, y: first.y });
    expect(useStudioStore.getState().editingId).toBeNull();
  });

  it("toggles rulers, guides and margins with layout-safe keys, also with Ctrl+R past the reload guard", () => {
    useViewPrefs.setState(DEFAULT_VIEW_PREFS);
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));

    press("R", { ctrlKey: false, shiftKey: true, code: "KeyR" });
    expect(useViewPrefs.getState().rulers).toBe(false);
    press("r");
    expect(useViewPrefs.getState().rulers).toBe(true);
    press("G", { ctrlKey: false, shiftKey: true, code: "KeyG" });
    press("M", { ctrlKey: false, shiftKey: true, code: "KeyM" });

    expect(useViewPrefs.getState()).toMatchObject({ guides: false, margins: false, rulers: true });
  });

  it("flips the selection with Shift+H and Shift+V on any keyboard layout, never while typing", () => {
    const { unmount } = renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    onTestFinished(unmount);
    const [first] = useStudioStore.getState().design?.pages[0].elements ?? [];
    useStudioStore.getState().select([first.id]);
    const input = document.body.appendChild(document.createElement("input"));
    const current = () => useStudioStore.getState().design?.pages[0].elements[0];

    press("H", { ctrlKey: false, shiftKey: true, code: "KeyH" });
    press("V", { ctrlKey: false, shiftKey: true, code: "KeyV" });
    expect(current()).toMatchObject({ flipX: true, flipY: true, x: first.x });
    press("H", { ctrlKey: false, shiftKey: true, code: "KeyH" }, input);
    press("H", { ctrlKey: false, shiftKey: true, code: "KeyH" });

    expect(current()?.flipX).toBeUndefined();
    expect(useStudioStore.getState().past).toHaveLength(3);
  });

  it("leaves the view alone while a field is being typed in", () => {
    useViewPrefs.setState(DEFAULT_VIEW_PREFS);
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    const input = document.body.appendChild(document.createElement("input"));

    press("R", { ctrlKey: false, shiftKey: true, code: "KeyR" }, input);

    expect(useViewPrefs.getState().rulers).toBe(true);
  });

  it("strikes selected texts with Ctrl+Shift+X and toggles lists with Ctrl+Shift+8 and 7", () => {
    const { unmount } = renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    onTestFinished(unmount);
    const state = useStudioStore.getState();
    const text = createText(0, 40, 100, 20, "a\nb");
    state.applyToPage((page) => addElements(page, [text]));
    state.select([text.id]);
    const current = () => useStudioStore.getState().design?.pages[0].elements.find((element) => element.id === text.id);

    press("X", { shiftKey: true, code: "KeyX" });
    press("*", { shiftKey: true, code: "Digit8" });
    expect(current()).toMatchObject({ strike: true, paragraphs: [{ list: "bullet", level: 0 }, { list: "bullet", level: 0 }] });

    press("/", { shiftKey: true, code: "Digit7" });
    press("/", { shiftKey: true, code: "Digit7" });
    expect(current()).toMatchObject({ paragraphs: [{ list: "none", level: 0 }, { list: "none", level: 0 }] });
  });

  it("opens find with Ctrl+F and replace with Ctrl+H, even from a text field", () => {
    const onFind = vi.fn();
    const { unmount } = renderHook(() => useStudioShortcuts(vi.fn(), vi.fn(), { onFind }));
    onTestFinished(unmount);
    const input = document.body.appendChild(document.createElement("input"));

    press("f");
    press("h", {}, input);
    press("F", { shiftKey: true });

    expect(onFind.mock.calls).toEqual([[false], [true]]);
  });

  it("does not claim Ctrl+F when no find handler is given", () => {
    removeGuard();
    removeGuard = () => undefined;
    const { unmount } = renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    onTestFinished(unmount);
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
