import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createShape, createText } from "../model/design";
import { addElements } from "../model/edit";
import { useStudioStore } from "./studioStore";
import { claimSystemPaste, clipboardImages, copiedText, expectSystemPaste, PASTE_WAIT_MS } from "./systemPaste";
import { useStudioShortcuts } from "./useStudioShortcuts";

const imports = vi.hoisted(() => ({ pasteImageFiles: vi.fn<(files: Blob[], onError?: (error: unknown) => void) => Promise<string[]>>(async () => []) }));

vi.mock("./imageImport", () => imports);

function transfer(files: File[], items: Array<{ kind: string; type: string; getAsFile: () => File | null }> = []) {
  return { files: files as unknown as FileList, items: items as unknown as DataTransferItemList };
}

function pasteEvent(data: ReturnType<typeof transfer> | null): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  return event;
}

const png = () => new File([new Uint8Array([1])], "a.png", { type: "image/png" });

describe("system clipboard paste", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    imports.pasteImageFiles.mockClear();
    const design = createDesign("Paste", 200, 100);
    const page = addElements(design.pages[0], [createShape("rect", 0, 0, 10, 10)]);
    useStudioStore.getState().open({ ...design, pages: [page] });
    useStudioStore.getState().select([page.elements[0].id]);
    useStudioStore.getState().copy();
  });

  afterEach(() => {
    claimSystemPaste();
    vi.useRealTimers();
    useStudioStore.getState().close();
    useStudioStore.setState({ clipboard: null });
  });

  it("finds raster pictures among clipboard files or items", () => {
    const fromItems = transfer([], [{ kind: "file", type: "image/jpeg", getAsFile: () => new File(["j"], "j.jpg", { type: "image/jpeg" }) }, { kind: "string", type: "text/plain", getAsFile: () => null }]);

    expect(clipboardImages(transfer([png(), new File(["t"], "t.txt", { type: "text/plain" })]))).toHaveLength(1);
    expect(clipboardImages(fromItems).map((file) => file.name)).toEqual(["j.jpg"]);
    expect(clipboardImages(transfer([new File(["s"], "s.svg", { type: "image/svg+xml" })]))).toEqual([]);
    expect(clipboardImages(null)).toEqual([]);
  });

  it("falls back to the waiting paste only once", () => {
    const fallback = vi.fn();

    expectSystemPaste(fallback);
    expectSystemPaste(fallback);
    vi.advanceTimersByTime(PASTE_WAIT_MS);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(claimSystemPaste()).toBe(false);
  });

  it("writes copied text for other programs", () => {
    expect(copiedText([createText(0, 0, 1, 1, "Hello"), createShape("rect", 0, 0, 1, 1), createText(0, 0, 1, 1, "World")])).toBe("Hello\nWorld");
    expect(copiedText([createShape("rect", 0, 0, 1, 1)])).toBe("");
  });

  it("pastes copied elements with Ctrl+V when the system clipboard has no picture", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(pasteEvent(transfer([])));

    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(2);
    vi.advanceTimersByTime(PASTE_WAIT_MS * 2);
    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(2);
    expect(imports.pasteImageFiles).not.toHaveBeenCalled();
  });

  it("still pastes copied elements when the web view sends no paste event", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));

    const key = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(key);
    vi.advanceTimersByTime(PASTE_WAIT_MS);

    expect(key.defaultPrevented).toBe(false);
    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(2);
  });

  it("inserts a pasted picture instead of the copied elements", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    const file = png();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
    const event = pasteEvent(transfer([file]));
    window.dispatchEvent(event);
    vi.advanceTimersByTime(PASTE_WAIT_MS * 2);

    expect(event.defaultPrevented).toBe(true);
    expect(imports.pasteImageFiles).toHaveBeenCalledWith([file], expect.any(Function));
    expect(useStudioStore.getState().design?.pages[0].elements).toHaveLength(1);
  });

  it("leaves pastes into text fields to the field", () => {
    renderHook(() => useStudioShortcuts(vi.fn(), vi.fn()));
    const input = document.body.appendChild(document.createElement("input"));

    const event = pasteEvent(transfer([png()]));
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(imports.pasteImageFiles).not.toHaveBeenCalled();
    input.remove();
  });
});
