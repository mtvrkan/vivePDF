import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { ViewerPanels } from "@/shared/store/viewerPanelsStore";
import { axeViolations } from "@/test/axe";
import { NavigationRail, ToolsRail } from "./ViewerRails";

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
    render(<ToolsRail panels={{ ...closedPanels, present: true }} onTogglePanel={onTogglePanel} pageColorsOn={false} onTogglePageColors={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Presentation tools" }));
    expect(onTogglePanel).toHaveBeenCalledWith("present");
    expect(usePresentationStore.getState().tool).toBe("pointer");
  });

  it("opens the edit menu beside the rail and names the active editing mode", () => {
    useViewerOverlayStore.getState().setMode("text");
    render(<ToolsRail panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn onTogglePageColors={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Edit" });
    expect(trigger.getAttribute("data-tip") ?? trigger.getAttribute("title")).toBe("Edit: Edit PDF");
    expect(screen.getByRole("button", { name: "Page colours" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Edit" })).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the edit menu closed until the trigger is pressed", () => {
    render(<ToolsRail panels={closedPanels} onTogglePanel={vi.fn()} pageColorsOn={false} onTogglePageColors={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-expanded")).toBe("false");
  });
});
