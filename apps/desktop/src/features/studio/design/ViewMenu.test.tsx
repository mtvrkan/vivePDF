import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axeViolations } from "@/test/axe";
import { createDesign } from "../model/design";
import { currentPage, useStudioStore } from "./studioStore";
import { ViewMenu } from "./ViewMenu";
import { DEFAULT_VIEW_PREFS, useViewPrefs } from "./viewPrefs";

beforeEach(() => {
  localStorage.clear();
  useViewPrefs.setState(DEFAULT_VIEW_PREFS);
  const design = createDesign("Card", 300, 200);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], guides: [{ axis: "x", position: 20 }] }] });
});

afterEach(() => {
  cleanup();
  useStudioStore.getState().close();
});

describe("studio view menu", () => {
  it("switches view aids on and off and remembers them", async () => {
    render(<ViewMenu />);

    fireEvent.click(screen.getByTestId("studio-view-menu"));
    const rulers = screen.getByRole("switch", { name: /studio.view.rulers/ });
    expect(rulers.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(rulers);

    expect(useViewPrefs.getState().rulers).toBe(false);
    expect(rulers.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("vivepdf.studioView")).toContain('"rulers":false');
    expect(await axeViolations(screen.getByRole("group"))).toEqual([]);
  });

  it("sets the page margins in one undo step and clears the guides of the page", () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByTestId("studio-view-menu"));
    const field = screen.getByLabelText(/studio.view.marginSize/);

    fireEvent.change(field, { target: { value: "12,5" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: /studio.view.clearGuides/ }));

    const state = useStudioStore.getState();
    expect(state.design?.margins).toBe(12.5);
    expect(currentPage(state)?.guides).toEqual([]);
    expect((screen.getByRole("button", { name: /studio.view.clearGuides/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => useStudioStore.getState().undo());
    act(() => useStudioStore.getState().undo());
    expect(useStudioStore.getState().design?.margins).toBe(0);
  });

  it("closes with Escape and ignores a margin that is not a number", () => {
    render(<ViewMenu />);
    fireEvent.click(screen.getByTestId("studio-view-menu"));
    const field = screen.getByLabelText(/studio.view.marginSize/);

    fireEvent.change(field, { target: { value: "wide" } });
    fireEvent.blur(field);
    expect(useStudioStore.getState().design?.margins).toBe(0);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByTestId("studio-view-menu").getAttribute("aria-expanded")).toBe("false");
  });
});
