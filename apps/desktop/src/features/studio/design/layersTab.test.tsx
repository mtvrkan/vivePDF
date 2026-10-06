import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createShape } from "../model/design";
import { groupElements } from "../model/layers";
import { LayersTab } from "./LayersTab";
import { currentPage, useStudioStore } from "./studioStore";

const order = () => currentPage(useStudioStore.getState())?.elements.map((element) => element.name) ?? [];

describe("layers tab", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    const design = createDesign("Card", 300, 200);
    const page = { ...design.pages[0], elements: ["A", "B", "C", "D"].map((name, index) => ({ ...createShape("rect", index * 20, 0, 10, 10), id: name, name })) };
    useStudioStore.getState().open({ ...design, pages: [groupElements(page, ["B", "C"]).page] });
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("selects a whole group from its row and one member after opening it", () => {
    render(<LayersTab />);

    fireEvent.click(screen.getByRole("button", { name: "Group (2)" }));
    expect(useStudioStore.getState().selection).toEqual(["B", "C"]);
    expect(screen.queryByRole("button", { name: "B" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Group (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(useStudioStore.getState().selection).toEqual(["B"]);
  });

  it("moves the focused layer with Alt and the arrow keys and keeps groups whole", () => {
    render(<LayersTab />);

    fireEvent.keyDown(screen.getByRole("button", { name: "A" }), { key: "ArrowUp", altKey: true });
    expect(order()).toEqual(["B", "C", "A", "D"]);

    fireEvent.keyDown(screen.getByRole("button", { name: "Group (2)" }), { key: "ArrowUp", altKey: true, shiftKey: true });
    expect(order()).toEqual(["A", "D", "B", "C"]);
  });

  it("disables moves that would leave the group or the page", () => {
    render(<LayersTab />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Group (2)" }));

    expect((screen.getByRole("button", { name: "Move C up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move D up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move B up" }));
    expect(order()).toEqual(["A", "C", "B", "D"]);
  });
});
