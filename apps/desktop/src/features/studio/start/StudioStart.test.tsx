import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useRecentDesignsStore } from "../design/recentDesigns";
import { useDocumentStore } from "../document/documentStore";
import { CARD_SIZES } from "../model/cards";
import { StudioStart } from "./StudioStart";
import { useStudioSectionStore } from "./studioSection";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  act(() => {
    useStudioSectionStore.setState({ section: "home", templateFilter: "all" });
    useDocumentStore.getState().close();
  });
});

function sectionButton(section: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-studio-section="${section}"]`);
  if (!found) throw new Error(`no ${section} section`);
  return found;
}

describe("StudioStart", () => {
  it("opens the business card page from the section list with one card per size", () => {
    render(<StudioStart onOpen={vi.fn()} />);

    fireEvent.click(sectionButton("card"));

    expect(screen.getByRole("heading", { level: 1, name: "Business card" })).toBeTruthy();
    expect(document.querySelectorAll("[data-size]")).toHaveLength(CARD_SIZES.length);
    expect(sectionButton("card").getAttribute("aria-current")).toBe("page");
    expect(sectionButton("card").textContent).toContain(String(CARD_SIZES.length));
  });

  it("goes to the design page from a quick start card", () => {
    render(<StudioStart onOpen={vi.fn()} />);

    fireEvent.click(document.querySelector('[data-quick-start="design"]') as HTMLElement);

    expect(document.querySelector('[data-studio-page="design"]')).toBeTruthy();
    expect(document.querySelector('[data-size="a4Landscape"]')).toBeTruthy();
  });

  it("shows an empty recent list whose button opens a blank document", () => {
    act(() => useRecentDesignsStore.setState({ items: [] }));
    render(<StudioStart onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Open a blank document" }));

    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(useDocumentStore.getState().document).not.toBeNull();
  });

  it("picks a template category from the list and marks only that row as current", () => {
    render(<StudioStart onOpen={vi.fn()} />);
    const menus = document.querySelector<HTMLElement>('[data-template-category="menus"]') as HTMLElement;

    fireEvent.click(menus);

    expect(useStudioSectionStore.getState()).toMatchObject({ section: "templates", templateFilter: "menus" });
    expect(menus.getAttribute("aria-current")).toBe("page");
    expect(sectionButton("templates").getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Menus");
  });
});
