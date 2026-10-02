import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Logo } from "./Logo";

afterEach(cleanup);

function references(svg: Element) {
  return Array.from(svg.querySelectorAll("*")).flatMap((element) =>
    Array.from(element.attributes)
      .map((attribute) => /^url\(#(.+)\)$/.exec(attribute.value)?.[1])
      .filter((value): value is string => !!value),
  );
}

describe("Logo", () => {
  it("draws the mark at the requested size with an accessible name", () => {
    render(<Logo size={48} />);

    const logo = screen.getByRole("img", { name: "vivePDF" });

    expect(logo.getAttribute("width")).toBe("48");
    expect(logo.getAttribute("height")).toBe("48");
  });

  it("points every gradient, clip and shadow at a definition inside the same logo", () => {
    render(<Logo />);

    const logo = screen.getByRole("img", { name: "vivePDF" });
    const used = references(logo);

    expect(used.length).toBeGreaterThan(8);
    for (const id of used) expect(logo.querySelector(`[id="${id}"]`)).not.toBeNull();
  });

  it("gives two logos on one page their own definitions", () => {
    render(
      <>
        <Logo />
        <Logo />
      </>,
    );

    const [first, second] = screen.getAllByRole("img", { name: "vivePDF" });
    const firstIds = new Set(references(first));

    expect(references(second).some((id) => firstIds.has(id))).toBe(false);
  });
});
