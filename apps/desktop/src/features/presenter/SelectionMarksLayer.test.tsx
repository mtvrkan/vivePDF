import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectionMarksLayer } from "./SelectionMarksLayer";

const MARKS = { color: "#FFD400", pages: { 1: [{ x: 0.1, y: 0.25, width: 0.5, height: 0.05 }] } };

afterEach(cleanup);

describe("SelectionMarksLayer", () => {
  it("draws the presenter's selection on the same spot of the page in the selection colour", () => {
    render(<SelectionMarksLayer marks={MARKS} pageIndex={1} />);

    const mark = document.querySelector<HTMLElement>("[data-remote-selection] > div") as HTMLElement;
    expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual(["10%", "25%", "50%", "5%"]);
    expect(mark.style.mixBlendMode).toBe("multiply");
  });

  it("draws nothing on a page without selected text or without a selection", () => {
    const { rerender } = render(<SelectionMarksLayer marks={MARKS} pageIndex={0} />);
    expect(document.querySelector("[data-remote-selection]")).toBeNull();

    rerender(<SelectionMarksLayer marks={null} pageIndex={1} />);
    expect(document.querySelector("[data-remote-selection]")).toBeNull();
  });
});
