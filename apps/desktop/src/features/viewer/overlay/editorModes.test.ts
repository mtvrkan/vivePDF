import { afterEach, describe, expect, it } from "vitest";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { isEditingMode, switchOverlayMode } from "./editorModes";

const note: EditorPending = { id: "note", kind: "text", pageIndex: 0, x: 10, y: 10, width: 100, height: 20, text: "Hi", style: { fontSize: 12, color: "#000000", bold: false, align: "left" }, opacity: 1 };

afterEach(() => {
  useViewerOverlayStore.getState().cancelLeave();
  useViewerOverlayStore.getState().setMode(null);
});

describe("switchOverlayMode", () => {
  it("moves between text and picture editing without asking and keeps the changes", () => {
    switchOverlayMode("text");
    useViewerOverlayStore.getState().addObject(note);

    switchOverlayMode("image");

    expect(useViewerOverlayStore.getState().mode).toBe("image");
    expect(useViewerOverlayStore.getState().objects).toHaveLength(1);
    expect(useViewerOverlayStore.getState().leaveNext).toBeNull();
  });

  it("asks before a page tool would drop unsaved edits", () => {
    switchOverlayMode("text");
    useViewerOverlayStore.getState().addObject(note);

    switchOverlayMode("crop");

    expect(useViewerOverlayStore.getState().mode).toBe("text");
    expect(useViewerOverlayStore.getState().leaveNext).not.toBeNull();
  });

  it("does nothing when the mode is already on", () => {
    switchOverlayMode("text");
    useViewerOverlayStore.getState().addObject(note);
    useViewerOverlayStore.getState().setSelectedObject("note");

    switchOverlayMode("text");

    expect(useViewerOverlayStore.getState().selectedObjectId).toBe("note");
  });
});

describe("isEditingMode", () => {
  it("counts editing and page tools but not area text or snapshots", () => {
    expect(["text", "image", "signature", "link", "redact", "crop", "measure"].every((mode) => isEditingMode(mode as never))).toBe(true);
    expect(isEditingMode("areaText")).toBe(false);
    expect(isEditingMode("snapshot")).toBe(false);
    expect(isEditingMode(null)).toBe(false);
  });
});
