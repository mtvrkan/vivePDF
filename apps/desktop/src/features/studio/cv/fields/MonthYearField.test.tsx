import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { formatMonthYear } from "../cvDates";
import { useCvStore } from "../cvStore";
import { MonthYearField } from "./MonthYearField";

let stored = "";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  stored = value;
  return (
    <MonthYearField
      label="Start"
      value={value}
      onChange={(next) => {
        stored = next;
        setValue(next);
      }}
    />
  );
}

const year = () => screen.getByRole("textbox", { name: "Start year" }) as HTMLInputElement;
const month = () => screen.getByRole("combobox", { name: "Start month" });
const pickMonth = (name: string) => {
  fireEvent.click(month());
  fireEvent.click(screen.getByRole("option", { name }));
};

describe("month and year field", () => {
  beforeAll(async () => {
    Element.prototype.scrollIntoView = () => undefined;
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    localStorage.clear();
    useCvStore.setState({ loaded: false });
    useCvStore.getState().open("en");
  });

  afterEach(() => {
    cleanup();
    useCvStore.getState().close();
  });

  it("writes the month and year in the CV language", () => {
    render(<Harness initial="" />);

    pickMonth("March");
    fireEvent.change(year(), { target: { value: "2021" } });

    expect(stored).toBe(formatMonthYear({ month: 3, year: 2021 }, "en"));
  });

  it("clears the date when the year is removed and marks the half-filled year", () => {
    render(<Harness initial={formatMonthYear({ month: 3, year: 2021 }, "en")} />);

    fireEvent.change(year(), { target: { value: "" } });

    expect(stored).toBe("");
    expect(month().textContent).toContain("March");
    expect(year().getAttribute("aria-invalid")).toBe("true");
  });

  it("still shows a date typed in another language after the CV language changes", () => {
    render(<Harness initial="Mart 2021" />);

    act(() => useCvStore.getState().updateTheme({ language: "de" }));

    expect(month().textContent).toContain("März");
    expect(year().value).toBe("2021");
  });
});
