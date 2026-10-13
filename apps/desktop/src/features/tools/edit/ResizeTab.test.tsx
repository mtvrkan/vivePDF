import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { useResizeState } from "./editFormState";
import { ResizeTab } from "./ResizeTab";
import type { PageSizePt } from "./paperSizes";

function Harness({ sourceSize }: { sourceSize: PageSizePt | null }) {
  const state = useResizeState();
  const [pages, setPages] = useState("");
  return (
    <>
      <ResizeTab state={state} pages={pages} onPagesChange={setPages} sourceSize={sourceSize} />
      <output data-testid="preset">{state.preset}</output>
    </>
  );
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("ResizeTab quick sizes", () => {
  it("shows how much each size shrinks or enlarges an A4 page and picks it", async () => {
    const { container } = render(<Harness sourceSize={{ width: 595, height: 842 }} />);
    const group = screen.getByRole("radiogroup", { name: "Quick sizes" });

    expect(screen.getByRole("radio", { name: /A5.*Shrink to 71%/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /A3.*Enlarge to 141%/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /A4.*About the same size/ }).getAttribute("aria-checked")).toBe("true");
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: /^A6/ }));

    expect(screen.getByTestId("preset").textContent).toBe("a6");
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toContain("A6");
  });

  it("leaves the comparison out before a file is chosen and follows the arrow keys", () => {
    render(<Harness sourceSize={null} />);

    expect(screen.queryByText(/Shrink to/)).toBeNull();
    expect(screen.getByText("Pick a file to see how much each size shrinks or enlarges it.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("radio", { name: /^A4/ }), { key: "ArrowDown" });

    expect(screen.getByTestId("preset").textContent).toBe("letter");
  });

  it("disables the quick sizes while matching the largest page", () => {
    render(<Harness sourceSize={{ width: 595, height: 842 }} />);

    fireEvent.click(screen.getByRole("switch", { name: /Match the largest page/ }));

    expect((screen.getByRole("radio", { name: /^A5/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
