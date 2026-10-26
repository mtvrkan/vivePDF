import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createShape } from "../model/design";
import { addElements } from "../model/edit";
import { ElementsPanel } from "./ElementsPanel";
import { useSidePanelsStore } from "./sidePanels";
import { useStudioStore } from "./studioStore";

vi.mock("../templates/TemplateGallery", () => ({ TemplateGallery: () => <p>gallery</p> }));
vi.mock("../merge/DataTab", () => ({ DataTab: () => <p>data</p> }));
vi.mock("./LayersTab", () => ({ LayersTab: () => <p>layers</p> }));

const iconRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("../icons/IconsSection", () => ({
  IconsSection: () => {
    iconRenders.count += 1;
    return null;
  },
}));

const panel = () => screen.getByRole("tabpanel");

describe("elements panel", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    useStudioStore.getState().open(createDesign("Card", 300, 200));
  });

  afterEach(() => {
    cleanup();
    useSidePanelsStore.getState().setPanelOpen(true);
    useStudioStore.getState().close();
  });

  it("opens another tab at the top instead of where the last one was scrolled", async () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));

    expect(panel().scrollTop).toBe(0);
    await waitFor(() => expect(panel().textContent).toBe("layers"));
  });

  it("keeps the scroll position while the same tab is clicked again", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Text" }));

    expect(panel().scrollTop).toBe(600);
  });

  it("returns to the text list at the top after visiting another tab", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
    fireEvent.click(screen.getByRole("tab", { name: "Text" }));

    expect(panel().scrollTop).toBe(0);
    expect(screen.getByRole("tab", { name: "Text" }).getAttribute("aria-selected")).toBe("true");
  });

  it("leaves the icons tab alone while the page is being edited", () => {
    render(<ElementsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Icons" }));
    const renders = iconRenders.count;

    act(() => useStudioStore.getState().applyToPage((page) => addElements(page, [createShape("rect", 10, 10, 50, 50)])));
    act(() => useStudioStore.getState().preview((design) => ({ ...design, pages: design.pages.map((page) => ({ ...page, elements: page.elements.map((element) => ({ ...element, x: element.x + 5 })) })) })));

    expect(renders).toBeGreaterThan(0);
    expect(iconRenders.count).toBe(renders);
  });

  it("hides the panel behind the rail and opens it again on the chosen category", () => {
    render(<ElementsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(screen.queryByRole("tabpanel")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Shapes" }));

    expect(useSidePanelsStore.getState().panelOpen).toBe(true);
    expect(panel().querySelector("[data-shape-preset]")).not.toBeNull();
  });

  it("moves between categories with the arrow keys", () => {
    render(<ElementsPanel />);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Text" }), { key: "ArrowDown" });

    expect(screen.getByRole("tab", { name: "Shapes" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Shapes" }));
  });
});
