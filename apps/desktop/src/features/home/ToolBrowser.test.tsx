import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { toolShortcuts, toolsInGroup } from "@/app/navigation";
import { ToolBrowser } from "./ToolBrowser";

function renderCatalogue(limit = 12) {
  render(
    <MemoryRouter>
      <ToolBrowser title="Tools" collapsible limit={limit} />
    </MemoryRouter>,
  );
  return screen.getByTestId("catalog-tools");
}

const cards = (pane: HTMLElement) => [...pane.querySelectorAll("[data-tool-card]")].map((card) => card.getAttribute("data-tool-card"));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("ToolBrowser catalogue", () => {
  it("lists every category with its count in the side rail and shows one category's tools", () => {
    const pane = renderCatalogue();
    const rail = screen.getByTestId("catalog-categories");

    fireEvent.click(rail.querySelector("[data-catalog-category=check]") as HTMLElement);

    expect(rail.querySelectorAll("[data-catalog-category]")).toHaveLength(14);
    expect((rail.querySelector("[data-catalog-category=all]") as HTMLElement).textContent).toContain(String(toolShortcuts.length));
    expect(rail.querySelector("[data-catalog-category=check]")?.getAttribute("aria-pressed")).toBe("true");
    expect(cards(pane)).toEqual(toolsInGroup("check").map((tool) => tool.id));
    expect(within(pane).getByText("Check")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("groups the first tools under All by category and opens the rest on Show all", () => {
    const pane = renderCatalogue(6);

    expect(cards(pane)).toHaveLength(6);
    expect(pane.querySelectorAll("section").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: `Show all · ${toolShortcuts.length}` }));

    expect(cards(pane)).toHaveLength(toolShortcuts.length);
    expect(pane.querySelectorAll("section")).toHaveLength(new Set(toolShortcuts.map((tool) => tool.group)).size);
  });

  it("says so when the search matches no tool in the chosen category", () => {
    const pane = renderCatalogue();
    fireEvent.click(screen.getByTestId("catalog-category-strip").querySelector("[data-catalog-category=scan]") as HTMLElement);

    fireEvent.change(screen.getByRole("textbox", { name: "Search tools" }), { target: { value: "watermark" } });

    expect(cards(pane)).toEqual([]);
    expect(within(pane).getByText("No tool matches your search.")).toBeTruthy();
  });
});
