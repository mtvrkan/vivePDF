import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { StudioElement } from "@/types/studio";
import { createDesign, createShape, createText } from "../model/design";
import { ContextBar } from "./ContextBar";
import { DetailsPanel } from "./PropertiesPanel";
import { useSidePanelsStore } from "./sidePanels";
import { useStudioStore } from "./studioStore";

function open(elements: StudioElement[], selected: StudioElement[] = elements) {
  const design = createDesign("Card", 400, 300);
  useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements }] });
  useStudioStore.getState().select(selected.map((element) => element.id));
}

const first = () => useStudioStore.getState().design?.pages[0].elements[0];

describe("studio context bar", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useSidePanelsStore.getState().closeDetails();
    useStudioStore.getState().close();
  });

  it("offers the text tools for a selected text and makes it bold and centred", () => {
    open([createText(10, 10, 200, 40, "Award")]);
    render(<ContextBar />);

    fireEvent.click(screen.getByRole("button", { name: /^Bold/ }));
    fireEvent.click(screen.getByRole("button", { name: "Centre" }));

    expect(screen.getByTestId("studio-context-kind").textContent).toBe("Text");
    expect(first()).toMatchObject({ kind: "text", align: "center" });
    expect(screen.getByRole("button", { name: /^Bold/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows page settings with nothing selected and no text tools for a shape", () => {
    const shape = createShape("rect", 0, 0, 40, 40);
    open([shape], []);
    const { rerender } = render(<ContextBar />);

    expect(screen.getByRole("button", { name: "Page settings" })).toBeTruthy();
    useStudioStore.getState().select([shape.id]);
    rerender(<ContextBar />);

    expect(screen.queryByRole("button", { name: /^Bold/ })).toBeNull();
    expect(screen.getByTestId("studio-context-kind").textContent).toBe("Shape");
  });

  it("opens the details panel on its position section and closes it again", () => {
    open([createShape("rect", 0, 0, 40, 40)]);
    render(
      <>
        <ContextBar />
        <DetailsPanel />
      </>,
    );
    expect(screen.queryByTestId("studio-properties")).toBeNull();

    fireEvent.click(screen.getByTestId("studio-context-arrange"));

    expect(screen.getByTestId("studio-properties")).toBeTruthy();
    expect(useSidePanelsStore.getState().target?.section).toBe("arrange");
    expect(document.getElementById("studio-details-arrange")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByTestId("studio-properties")).toBeNull();
    expect(screen.getByTestId("studio-details-toggle").getAttribute("aria-pressed")).toBe("false");
  });
});
