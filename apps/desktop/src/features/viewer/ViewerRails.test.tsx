import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { ViewerPanels } from "@/shared/store/viewerPanelsStore";
import { axeViolations } from "@/test/axe";
import { NavigationRail, ToolsRail } from "./ViewerRails";

const rotateForward = vi.fn();
const zoomIn = vi.fn();
const zoomOut = vi.fn();

vi.mock("@embedpdf/plugin-rotate/react", () => ({ useRotate: () => ({ provides: { rotateForward } }) }));
vi.mock("@embedpdf/plugin-zoom/react", () => ({ useZoom: () => ({ provides: { zoomIn, zoomOut } }) }));
vi.mock("./PageNavigator", () => ({ PageNavigator: () => <input aria-label="Page number" /> }));
vi.mock("./PageDisplayMenu", () => ({ PageDisplayMenu: () => <button type="button">Page display</button> }));

const closedPanels: ViewerPanels = { thumbnails: false, outline: false, search: false, inspector: false, annotate: false, comments: false, attachments: false, readAloud: false, reading: false, present: false, translate: false, signatures: false, layers: false };

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  usePresentationStore.getState().setTool("pointer");
  useViewerOverlayStore.getState().setMode(null);
});

afterEach(cleanup);

describe("NavigationRail", () => {
  it("toggles the navigation panels and marks the open ones as pressed", async () => {
    const onTogglePanel = vi.fn();
    const { container } = render(<NavigationRail panels={{ ...closedPanels, thumbnails: true }} onTogglePanel={onTogglePanel} />);
    expect(screen.getByRole("toolbar", { name: "Navigation" }).getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByRole("button", { name: "Thumbnails" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Attachments" }));
    expect(onTogglePanel).toHaveBeenCalledWith("attachments");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the signature and layer panels only for documents that have them", () => {
    const onTogglePanel = vi.fn();
    const { rerender } = render(<NavigationRail panels={closedPanels} onTogglePanel={onTogglePanel} />);
    expect(screen.queryByRole("button", { name: "Layers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Signatures" })).toBeNull();
    rerender(<NavigationRail panels={{ ...closedPanels, layers: true }} onTogglePanel={onTogglePanel} showLayers showSignatures />);
    expect(screen.getByRole("button", { name: "Layers" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Signatures" }));
    expect(onTogglePanel).toHaveBeenCalledWith("signatures");
  });

  it("moves focus with the arrow keys and wraps at both ends", () => {
    render(<NavigationRail panels={closedPanels} onTogglePanel={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar", { name: "Navigation" });
    const buttons = screen.getAllByRole("button");
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(document.activeElement ?? toolbar, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});

describe("ToolsRail", () => {
  it("resets the presentation pointer tool when presentation tools close", () => {
    const onTogglePanel = vi.fn();
    usePresentationStore.getState().setTool("laser");
    render(<ToolsRail documentId="doc" panels={{ ...closedPanels, present: true }} onTogglePanel={onTogglePanel} pageColorsOn={false} onTogglePageColors={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    expect(onTogglePanel).toHaveBeenCalledWith("present");
    expect(usePresentationStore.getState().tool).toBe("pointer");
  });

  it("enters PDF editing with one click and leaves it with the next", () => {
    render(<ToolsRail documentId="doc" panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn onTogglePageColors={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Edit" });

    fireEvent.click(trigger);
    expect(useViewerOverlayStore.getState().mode).toBe("text");
    expect(trigger.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);

    expect(useViewerOverlayStore.getState().mode).toBeNull();
    expect(screen.getByRole("button", { name: "Page colours" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("asks before leaving editing that has unsaved changes", () => {
    useViewerOverlayStore.getState().setMode("text");
    useViewerOverlayStore.getState().addObject({ id: "note", kind: "text", pageIndex: 0, x: 10, y: 10, width: 100, height: 20, text: "Hi", style: { fontSize: 12, color: "#000000", bold: false, align: "left" }, opacity: 1 });
    render(<ToolsRail documentId="doc" panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn={false} onTogglePageColors={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(useViewerOverlayStore.getState().mode).toBe("text");
    expect(useViewerOverlayStore.getState().leaveNext).not.toBeNull();
    useViewerOverlayStore.getState().cancelLeave();
  });

  it("shows a page tool as part of editing and closes it from the rail", () => {
    useViewerOverlayStore.getState().setMode("signature");
    render(<ToolsRail documentId="doc" panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn={false} onTogglePageColors={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Edit" });

    expect(trigger.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(trigger);

    expect(useViewerOverlayStore.getState().mode).toBeNull();
  });

  it("keeps page navigation, rotation, page display and zoom at the bottom of the rail", () => {
    render(<ToolsRail documentId="doc" panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn={false} onTogglePageColors={vi.fn()} />);
    const controls = Array.from(screen.getByRole("toolbar", { name: "Tools" }).querySelectorAll("button, input")).map((node) => node.getAttribute("aria-label") ?? node.textContent);

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(controls.slice(-5)).toEqual(["Page number", "Rotate", "Page display", "Zoom in", "Zoom out"]);
    expect(rotateForward).toHaveBeenCalledTimes(1);
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
  });
});
