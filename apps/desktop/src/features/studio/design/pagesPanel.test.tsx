import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createShape } from "../model/design";
import { addPage } from "../model/pages";
import { PagesStrip } from "./PagesStrip";
import { PropertiesPanel } from "./PropertiesPanel";
import { useStudioStore } from "./studioStore";

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Object.defineProperty(HTMLElement.prototype, "getClientRects", { configurable: true, value: () => [{ width: 10, height: 10 }] });
});

function openDesign() {
  let design = createDesign("Deck", 200, 100);
  design = addPage(design, null).design;
  design = addPage(design, null).design;
  design.pages[0].elements.push({ ...createShape("rect", 0, 0, 200, 100), id: "box" });
  design.pages[1] = { ...design.pages[1], name: "Cover", width: 300 };
  useStudioStore.getState().open(design);
  return design;
}

const pageIds = () => useStudioStore.getState().design?.pages.map((page) => page.id) ?? [];

describe("pages strip", () => {
  beforeEach(openDesign);
  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("lists every page with its name and goes to the clicked one", () => {
    render(<PagesStrip language="en" />);
    const strip = screen.getByRole("list", { name: "Pages" });

    expect(within(strip).getAllByRole("button", { name: /^Page \d/ })).toHaveLength(3);
    fireEvent.click(within(strip).getByRole("button", { name: "Page 2: Cover" }));

    expect(useStudioStore.getState().pageId).toBe(pageIds()[1]);
  });

  it("reorders pages from the overview without dragging and picks a page", () => {
    const before = pageIds();
    render(<PagesStrip language="en" />);

    fireEvent.click(screen.getByRole("button", { name: "All pages" }));
    const dialog = screen.getByRole("dialog");
    const earlier = within(dialog).getAllByRole("button", { name: /^Move page \d+ earlier$/ });
    expect((earlier[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getAllByRole("button", { name: /^Move page \d+ later$/ })[0]);

    expect(pageIds()).toEqual([before[1], before[0], before[2]]);
    fireEvent.click(within(dialog).getAllByRole("button", { name: /^Page \d/ })[2]);
    expect(useStudioStore.getState().pageId).toBe(before[2]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("page settings", () => {
  beforeEach(openDesign);
  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("names the page", () => {
    render(<PropertiesPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "Page name" }), { target: { value: "Back cover" } });

    expect(useStudioStore.getState().design?.pages[0].name).toBe("Back cover");
  });

  it("applies the page size to every page in one undoable step", () => {
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Apply this size to all pages" }));

    expect(useStudioStore.getState().design?.pages.map((page) => page.width)).toEqual([200, 200, 200]);
    expect((screen.getByRole("button", { name: "Apply this size to all pages" }) as HTMLButtonElement).disabled).toBe(true);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().design?.pages.map((page) => page.width)).toEqual([200, 300, 200]);
  });

  it("scales the content with the page when asked to", () => {
    render(<PropertiesPanel />);

    fireEvent.click(screen.getByRole("radio", { name: "Scale to fit" }));
    const width = screen.getByRole("textbox", { name: /^Width/ });
    fireEvent.change(width, { target: { value: String((400 * 25.4) / 72) } });
    fireEvent.blur(width);

    const box = useStudioStore.getState().design?.pages[0].elements[0];
    expect(box?.width).toBeCloseTo(200);
    expect(box?.x).toBeCloseTo(100);
  });
});
