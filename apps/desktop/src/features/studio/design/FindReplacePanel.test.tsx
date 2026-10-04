import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createText } from "../model/design";
import { FindReplacePanel } from "./FindReplacePanel";
import { useStudioStore } from "./studioStore";

function texts() {
  return (useStudioStore.getState().design?.pages ?? []).flatMap((page) => page.elements.map((element) => (element.kind === "text" ? element.runs.map((run) => run.text).join("") : "")));
}

describe("studio find and replace panel", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    const design = createDesign("Deck", 200, 100);
    const first = { ...design.pages[0], elements: [createText(0, 0, 100, 20, "red apple")] };
    const second = { ...design.pages[0], id: "page-2", elements: [createText(0, 0, 100, 20, "Red car, red door")] };
    useStudioStore.getState().open({ ...design, pages: [first, second] });
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("counts matches on every page and walks to them with Enter", () => {
    render(<FindReplacePanel mode={{ replace: false, nonce: 1 }} language="en" onClose={vi.fn()} />);
    const find = screen.getByRole("textbox", { name: "Find" });

    fireEvent.change(find, { target: { value: "red" } });
    expect(screen.getByRole("status").textContent).toBe("3 matches");
    fireEvent.keyDown(find, { key: "Enter" });
    fireEvent.keyDown(find, { key: "Enter" });

    expect(screen.getByRole("status").textContent).toBe("2 of 3");
    expect(useStudioStore.getState().pageId).toBe("page-2");
    expect(useStudioStore.getState().selection).toHaveLength(1);
  });

  it("replaces every match as one undo step", () => {
    render(<FindReplacePanel mode={{ replace: true, nonce: 1 }} language="en" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "red" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "blue" } });

    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    expect(texts()).toEqual(["blue apple", "blue car, blue door"]);
    act(() => useStudioStore.getState().undo());
    expect(texts()).toEqual(["red apple", "Red car, red door"]);
  });

  it("reports no matches and closes with Escape", () => {
    const onClose = vi.fn();
    render(<FindReplacePanel mode={{ replace: false, nonce: 1 }} language="en" onClose={onClose} />);
    const find = screen.getByRole("textbox", { name: "Find" });

    fireEvent.change(find, { target: { value: "green" } });
    fireEvent.keyDown(find, { key: "Escape" });

    expect(screen.getByRole("status").textContent).toBe("No matches");
    expect(screen.getByRole("button", { name: "Next match" })).toHaveProperty("disabled", true);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
