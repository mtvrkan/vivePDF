import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createText } from "../model/design";
import { defaultFinish } from "../model/finish";
import { ElementView } from "./ElementView";
import { PropertiesPanel } from "./PropertiesPanel";
import { useStudioStore } from "./studioStore";

const element = () => useStudioStore.getState().design?.pages[0].elements[0];

function pick(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("print finish section", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => undefined;
  });

  beforeEach(() => {
    const design = createDesign("Card", 240, 155);
    const name = createText(20, 20, 160, 40, "Ada Lovelace");
    useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [name] }] });
    useStudioStore.getState().select([name.id]);
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("embosses the selected text with blind ink by default", () => {
    render(<PropertiesPanel />);

    pick("Finish", "Embossed");

    expect(element()?.finish).toEqual(defaultFinish("emboss"));
    expect(screen.getByTestId("studio-finish-fields")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /Blind/ })).toBeTruthy();
  });

  it("switches foil colours and turns the finish off again", () => {
    render(<PropertiesPanel />);
    pick("Finish", "Foil");

    pick("Foil colour", "Rose gold");
    expect(element()?.finish?.foil).toBe("roseGold");
    pick("Finish", "None");

    expect(element()?.finish).toBeUndefined();
    expect(screen.queryByTestId("studio-finish-fields")).toBeNull();
  });

  it("changes only the edited setting on every selected element and keeps their own finishes", () => {
    const design = createDesign("Card", 240, 155);
    const gold = { ...createText(20, 20, 160, 40, "Gold"), finish: defaultFinish("foil", "gold") };
    const silver = { ...createText(20, 80, 160, 40, "Silver"), finish: { ...defaultFinish("foil", "silver"), depth: 2 } };
    useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [gold, silver] }] });
    useStudioStore.getState().select([gold.id, silver.id]);
    render(<PropertiesPanel />);

    pick("Foil colour", "Copper");

    const [first, second] = useStudioStore.getState().design?.pages[0].elements ?? [];
    expect(first.finish).toEqual({ ...gold.finish, foil: "copper" });
    expect(second.finish).toEqual({ ...silver.finish, foil: "copper" });
  });

  it("draws a finished element through its own SVG filter", () => {
    const finished = { ...createText(0, 0, 100, 30, "Foil"), finish: defaultFinish("foil") };

    const { container } = render(<ElementView element={finished} language="en" />);

    const frame = container.querySelector<HTMLElement>("[data-finish='foil']");
    const filter = container.querySelector("filter");
    expect(filter?.id).toBeTruthy();
    expect(frame?.style.filter).toContain(`#${filter?.id}`);
    expect(container.querySelector("feImage")).toBeTruthy();
  });
});
