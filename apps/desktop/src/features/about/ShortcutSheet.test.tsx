import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { ShortcutSheet } from "./ShortcutSheet";
import { useShortcutSheetStore } from "./shortcutSheetStore";

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ShortcutSheet />
    </MemoryRouter>,
  );

describe("shortcut sheet", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useShortcutSheetStore.setState({ open: false, studioScreen: null });
  });

  it("opens with F1 on the page organizer and shows its own shortcuts", () => {
    renderAt("/pages");

    act(() => void fireEvent.keyDown(window, { key: "F1" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Page organizer");
    expect(dialog.textContent).toContain("Invert selection");
    expect(dialog.textContent).not.toContain("Studio design editor");
  });

  it("opens with Ctrl+/ in the Studio document editor and closes on a second press", () => {
    useShortcutSheetStore.setState({ studioScreen: "document" });
    renderAt("/studio");

    act(() => void fireEvent.keyDown(window, { key: "/", ctrlKey: true }));
    expect(screen.getByRole("dialog").textContent).toContain("Studio document editor");

    act(() => void fireEvent.keyDown(window, { key: "/", ctrlKey: true }));
    expect(useShortcutSheetStore.getState().open).toBe(false);
  });

  it("stays shut when a screen already used the key for its own help", () => {
    renderAt("/viewer");
    const handled = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", handled, true);

    act(() => void fireEvent.keyDown(window, { key: "F1" }));

    window.removeEventListener("keydown", handled, true);
    expect(useShortcutSheetStore.getState().open).toBe(false);
  });
});
