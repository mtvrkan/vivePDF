import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createSvg } from "../model/design";
import { PropertiesPanel } from "../design/PropertiesPanel";
import { currentPage, useStudioStore } from "../design/studioStore";
import { IconsSection } from "./IconsSection";

const elements = () => currentPage(useStudioStore.getState())?.elements ?? [];
const heart = () => screen.findByRole("button", { name: "Add icon: Heart" }, { timeout: 20000 });

describe("icon library in the elements panel", { timeout: 30000 }, () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    useStudioStore.getState().open({ ...createDesign("Icons", 400, 300), palette: ["#1f4e8c"] });
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("shows featured icons and adds a clicked one as a centred, recolourable vector", async () => {
    render(<IconsSection />);
    fireEvent.click(await heart());

    const [icon] = elements();
    expect(icon.kind).toBe("vector");
    expect(icon).toMatchObject({ name: "Heart", width: 60, height: 60, x: 170, y: 120 });
    expect(icon.kind === "vector" && icon.paths[0].stroke).toMatchObject({ color: "#1f4e8c", width: 2, cap: "round", join: "round" });
    expect(useStudioStore.getState().selection).toEqual([icon.id]);
  });

  it("searches by name and synonym and offers a way out when nothing matches", async () => {
    render(<IconsSection />);
    await heart();
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    fireEvent.change(search, { target: { value: "love" } });
    const grid = screen.getByRole("group", { name: "Icons" });
    expect(within(grid).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Add icon: Heart");

    fireEvent.change(search, { target: { value: "qqqzzz" } });
    expect(screen.getByText("No icons found")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1) as HTMLElement);
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("moves through the grid with the arrow keys and adds the focused icon with Enter", async () => {
    render(<IconsSection />);
    const first = await heart();
    expect(first.tabIndex).toBe(0);
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("button", { name: "Add icon: Star" });
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).dataset.iconIndex).toBe("7");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End", ctrlKey: true });
    expect((document.activeElement as HTMLElement).dataset.iconIndex).toBe("11");
  });

  it("opens the whole library with categories and adds the chosen icon", async () => {
    render(<IconsSection />);
    await heart();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    const dialog = screen.getByRole("dialog", { name: "Icon library" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Food & drink" }));
    expect(within(dialog).getByRole("button", { name: "Food & drink" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search icons" }), { target: { value: "coffee" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add icon: Coffee" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(elements().map((element) => element.name)).toEqual(["Coffee"]);
  });
});

describe("svg colours in the properties panel", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("lists each colour of an imported drawing and resets the swaps in one step", () => {
    const svg = createSvg('<svg width="10" height="10"><rect fill="#FF0000" width="5" height="5"/><circle stroke="blue" r="2"/></svg>', 0, 0, 100, 100);
    const design = createDesign("Svg", 400, 300);
    useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [{ ...svg, colorMap: { "#0000ff": "#00aa00" } }] }] });
    useStudioStore.getState().select([svg.id]);
    render(<PropertiesPanel />);

    expect(screen.getByRole("button", { name: "Colour #ff0000: #ff0000" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Colour #00aa00: #00aa00" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset colours" }));
    const [element] = elements();
    expect(element.kind === "svg" && element.colorMap).toBeUndefined();
    expect(screen.getByRole("button", { name: "Colour #0000ff: #0000ff" })).toBeTruthy();
    useStudioStore.getState().undo();
    const [restored] = elements();
    expect(restored.kind === "svg" && restored.colorMap).toEqual({ "#0000ff": "#00aa00" });
  });
});
