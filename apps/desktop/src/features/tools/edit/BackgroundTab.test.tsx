import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { BackgroundTab, type BackgroundSettings } from "./BackgroundTab";

function Harness() {
  const [settings, setSettings] = useState<BackgroundSettings>({ mode: "add", color: "#fff8e1" });
  const [pages, setPages] = useState("");
  return (
    <>
      <BackgroundTab settings={settings} onChange={(patch) => setSettings((state) => ({ ...state, ...patch }))} pages={pages} onPagesChange={setPages} />
      <output data-testid="mode">{settings.mode}</output>
      <output data-testid="pages">{pages}</output>
    </>
  );
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("BackgroundTab", () => {
  it("offers a colour while adding, without accessibility problems", async () => {
    const { container } = render(<Harness />);

    const colour = screen.queryAllByRole("button", { name: /Colour/ });

    expect(colour.length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: /Add colour/ }).getAttribute("aria-checked")).toBe("true");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("hides the colour when removing an earlier background", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("radio", { name: /Remove colour/ }));

    expect(screen.getByTestId("mode").textContent).toBe("remove");
    expect(screen.queryAllByRole("button", { name: /Colour/ })).toEqual([]);
  });

  it("keeps the typed page range", () => {
    render(<Harness />);

    fireEvent.change(screen.getByPlaceholderText("all pages"), { target: { value: "2-4" } });

    expect(screen.getByTestId("pages").textContent).toBe("2-4");
  });
});
