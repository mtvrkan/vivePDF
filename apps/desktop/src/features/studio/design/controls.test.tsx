import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { NumberInput } from "./controls";

const field = () => screen.getByLabelText("Width") as HTMLInputElement;

function renderInput(props: Partial<Parameters<typeof NumberInput>[0]> = {}) {
  const onChange = vi.fn();
  render(<NumberInput ariaLabel="Width" value={10} onChange={onChange} {...props} />);
  return onChange;
}

describe("number input", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(cleanup);

  it("reads a comma as the decimal mark and puts back the value when the text is not a number", () => {
    const onChange = renderInput();
    fireEvent.change(field(), { target: { value: " 12,5 " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.change(field(), { target: { value: "abc" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onChange.mock.calls).toEqual([[12.5]]);
    expect(field().value).toBe("10");
  });

  it("goes back to the stored value on Escape without changing anything", () => {
    const onChange = renderInput();
    field().focus();
    fireEvent.change(field(), { target: { value: "55" } });

    fireEvent.keyDown(field(), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe("10");
    expect(document.activeElement).not.toBe(field());
  });

  it("steps from the typed number and tags every step with the field's merge key", () => {
    const onChange = renderInput({ mergeKey: "width", step: 1 });
    fireEvent.change(field(), { target: { value: "20" } });

    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });

    expect(onChange.mock.calls).toEqual([
      [21, "width"],
      [31, "width"],
    ]);
  });

  it("keeps a typed number inside its limits", () => {
    const onChange = renderInput({ min: 1, max: 50 });
    fireEvent.change(field(), { target: { value: "500" } });

    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(50);
    expect(field().value).toBe("50");
  });

  it("does not step a mixed value until a number is typed", () => {
    const onChange = renderInput({ mixed: true });

    fireEvent.keyDown(field(), { key: "ArrowDown" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
