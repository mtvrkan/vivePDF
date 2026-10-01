import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { axeViolations } from "@/test/axe";
import { Select, type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = Array.from({ length: 30 }, (_, index) => ({ value: `v${index}`, label: `Option ${index}` }));
const style = document.createElement("style");
const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeAll(() => {
  style.textContent = ".overflow-y-auto { overflow-y: auto; } .overflow-hidden { overflow: hidden; }";
  document.head.appendChild(style);
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("overflow-y-auto") ? 900 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("overflow-y-auto") ? 288 : 0;
    },
  });
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(HTMLElement.prototype, "getClientRects", { configurable: true, value: () => [{ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }] });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [{ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }] });
});

afterAll(() => {
  style.remove();
  if (scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
});

afterEach(cleanup);

function Harness({ searchable = false }: { searchable?: boolean }) {
  const [value, setValue] = useState("v0");
  return (
    <div>
      <Select value={value} options={OPTIONS} onChange={setValue} ariaLabel="Language" searchable={searchable} searchPlaceholder="Filter" />
      <output data-testid="value">{value}</output>
    </div>
  );
}

function press(target: Element, key: string) {
  act(() => {
    fireEvent.keyDown(target, { key });
  });
}

describe("Select", () => {
  it("has a keyboard-reachable scroll region and no axe violations while open", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    act(() => {
      fireEvent.click(trigger);
    });
    const listbox = screen.getByRole("listbox", { name: "Language" });
    expect(listbox.className).toContain("overflow-y-auto");
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    const scrollRule = await axe.run(document.body, { runOnly: { type: "rule", values: ["scrollable-region-focusable"] } });
    expect(scrollRule.violations).toEqual([]);
    expect(scrollRule.incomplete).toEqual([]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("keeps aria-activedescendant keyboard selection on the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    trigger.focus();
    press(trigger, "ArrowDown");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    press(trigger, "ArrowDown");
    press(trigger, "ArrowDown");
    const active = trigger.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? "")?.textContent).toBe("Option 2");
    expect(document.activeElement).toBe(trigger);
    press(trigger, "Enter");
    expect(screen.getByTestId("value").textContent).toBe("v2");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger after a mouse pick", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    act(() => {
      fireEvent.click(trigger);
    });
    act(() => {
      fireEvent.click(screen.getByRole("option", { name: "Option 5" }));
    });
    expect(screen.getByTestId("value").textContent).toBe("v5");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the search box focused and filtering in searchable mode", async () => {
    render(<Harness searchable />);
    act(() => {
      fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    });
    const search = screen.getByRole("textbox", { name: "Filter" });
    expect(document.activeElement).toBe(search);
    act(() => {
      fireEvent.change(search, { target: { value: "Option 1" } });
    });
    expect(screen.getAllByRole("option").length).toBe(11);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
