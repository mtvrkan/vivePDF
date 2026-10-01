import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "@/test/axe";
import { ControlLabelContext } from "./fieldDescription";
import { Checkbox, OptionCards, SwitchField } from "./form";

afterEach(cleanup);

describe("Checkbox", () => {
  it("takes its accessible name from the surrounding setting row when it has no label of its own", async () => {
    const { container } = render(
      <div>
        <span id="row-label">Reduce motion</span>
        <ControlLabelContext value="row-label">
          <Checkbox label="" checked={false} onChange={() => undefined} />
        </ControlLabelContext>
      </div>,
    );
    expect(screen.getByRole("switch", { name: "Reduce motion" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("prefers its own label over the row label", () => {
    render(
      <ControlLabelContext value="row-label">
        <span id="row-label">Row</span>
        <Checkbox label="Keep backups" checked onChange={() => undefined} />
      </ControlLabelContext>,
    );
    const toggle = screen.getByRole("switch", { name: "Keep backups" });
    expect(toggle.getAttribute("aria-labelledby")).toBeNull();
  });

  it("reports the new state on click", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Grayscale" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Grayscale" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("SwitchField", () => {
  it("names the switch after the field label and passes axe", async () => {
    const { container } = render(<SwitchField label="Flatten forms" hint="Makes fields static" checked onChange={() => undefined} />);
    expect(screen.getByRole("switch", { name: "Flatten forms" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("OptionCards", () => {
  const options = [
    { value: "ranges" as const, title: "By ranges", description: "Split at page ranges." },
    { value: "count" as const, title: "By count", description: "Parts with a fixed page count." },
  ];

  it("is a labelled radio group with one tab stop and readable descriptions", async () => {
    const { container } = render(<OptionCards value="ranges" options={options} onChange={() => undefined} ariaLabel="Split mode" />);
    const radios = screen.getAllByRole("radio");
    expect(screen.getByRole("radiogroup", { name: "Split mode" })).toBeTruthy();
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1]);
    expect(screen.getByText("Parts with a fixed page count.").className).toContain("text-muted-foreground");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("moves the selection with the arrow keys", () => {
    const onChange = vi.fn();
    render(<OptionCards value="ranges" options={options} onChange={onChange} ariaLabel="Split mode" />);
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("count");
  });
});
