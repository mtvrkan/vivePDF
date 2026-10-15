import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useShortcutSheetStore } from "@/features/about/shortcutSheetStore";
import { useUiStore } from "@/shared/store/uiStore";
import { HelpKeyListener } from "./HelpKeyListener";
import { HelpPage } from "./HelpPage";

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <HelpKeyListener />
      <Location />
      <Routes>
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );

const location = () => screen.getByTestId("location").textContent;

describe("help page", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useShortcutSheetStore.setState({ open: false, studioScreen: null });
    useUiStore.setState({ immersive: false });
  });

  it("shows the topic named in the address with its numbered steps", () => {
    renderAt("/help?topic=ocr");

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Make scanned pages searchable (OCR)");
    expect(screen.getByTestId("help-steps").querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Make scanned pages searchable/ }).getAttribute("aria-current")).toBe("page");
  });

  it("opens the screen a topic is about", () => {
    renderAt("/help?topic=convert");

    fireEvent.click(screen.getByRole("button", { name: "Open this screen" }));

    expect(location()).toBe("/tools/convert");
  });

  it("narrows the list by search, ignoring accents and case, and shows an empty state with no match", () => {
    renderAt("/help");
    const search = screen.getByRole("searchbox", { name: "Search help" });

    fireEvent.change(search, { target: { value: "PRÉSENTER" } });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Present a PDF");

    fireEvent.change(search, { target: { value: "zzqx" } });
    expect(screen.queryByTestId("help-steps")).toBeNull();
    expect(screen.getByText("No help topics match “zzqx”")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(10);
  });

  it("hides the open button for a topic without its own screen", () => {
    renderAt("/help?topic=troubleshooting");

    expect(screen.queryByRole("button", { name: "Open this screen" })).toBeNull();
  });

  it("opens the topic for the current screen with Shift+F1", () => {
    useShortcutSheetStore.setState({ studioScreen: "document" });
    renderAt("/studio");

    act(() => void fireEvent.keyDown(window, { key: "F1", shiftKey: true }));

    expect(location()).toBe("/help?topic=studioDocument");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Write a document in Studio");
  });

  it("leaves Shift+F1 alone when a screen already handled it, and plain F1 to the shortcut sheet", () => {
    renderAt("/tools/sign");

    act(() => void fireEvent.keyDown(window, { key: "F1" }));
    const prevented = new KeyboardEvent("keydown", { key: "F1", shiftKey: true, cancelable: true });
    prevented.preventDefault();
    act(() => void window.dispatchEvent(prevented));

    expect(location()).toBe("/tools/sign");
  });
});
