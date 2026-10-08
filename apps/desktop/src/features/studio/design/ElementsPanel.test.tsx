import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createShape } from "../model/design";
import { addElements } from "../model/edit";
import { ElementsPanel } from "./ElementsPanel";
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
    useStudioStore.getState().close();
  });

  it("opens another tab at the top instead of where the last one was scrolled", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));

    expect(panel().scrollTop).toBe(0);
    expect(panel().textContent).toBe("layers");
  });

  it("keeps the scroll position while the same tab is clicked again", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Elements" }));

    expect(panel().scrollTop).toBe(600);
  });

  it("returns to the elements list at the top after visiting another tab", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
    fireEvent.click(screen.getByRole("tab", { name: "Elements" }));

    expect(panel().scrollTop).toBe(0);
    expect(screen.getByRole("tab", { name: "Elements" }).getAttribute("aria-selected")).toBe("true");
  });

  it("leaves the elements tab alone while the page is being edited", () => {
    render(<ElementsPanel />);
    const renders = iconRenders.count;

    act(() => useStudioStore.getState().applyToPage((page) => addElements(page, [createShape("rect", 10, 10, 50, 50)])));
    act(() => useStudioStore.getState().preview((design) => ({ ...design, pages: design.pages.map((page) => ({ ...page, elements: page.elements.map((element) => ({ ...element, x: element.x + 5 })) })) })));

    expect(iconRenders.count).toBe(renders);
  });
});
