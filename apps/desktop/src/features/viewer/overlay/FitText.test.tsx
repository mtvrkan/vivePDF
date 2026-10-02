import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlockRun } from "@/shared/store/viewerOverlayStore";
import { FitText } from "./FitText";

const run = (text: string, size: number): BlockRun => ({ font: null, fontXref: 0, size, color: "#000000", bold: false, italic: false, superscript: false, text });

afterEach(cleanup);

function box(container: HTMLElement) {
  return container.firstElementChild as HTMLElement;
}

describe("FitText", () => {
  it("sizes the box to the text so line spacing follows the page, not the app font", () => {
    const { container } = render(<FitText runs={[run("Memo line", 9)]} runStyle={(_, size) => ({ fontSize: size })} style={{ lineHeight: 12 / 9 }} baseSizePt={9} pxPerPt={2} />);

    expect(box(container).style.fontSize).toBe("18px");
    expect(box(container).style.lineHeight).toBe(String(12 / 9));
  });

  it("scales each run by the pixel ratio of the page", () => {
    const { container } = render(<FitText runs={[run("Big", 20), run("small", 10)]} runStyle={(_, size) => ({ fontSize: size })} style={{}} baseSizePt={20} pxPerPt={1.5} />);

    const sizes = Array.from(box(container).querySelectorAll<HTMLElement>("span")).map((span) => span.style.fontSize);
    expect(sizes).toEqual(["30px", "15px"]);
  });

  it("reports no fitted size when the text already fits", () => {
    let reported: number | null | undefined;
    render(<FitText runs={[run("Fits", 12)]} runStyle={(_, size) => ({ fontSize: size })} style={{}} baseSizePt={12} pxPerPt={1} onFittedSize={(size) => (reported = size)} />);

    expect(reported).toBeNull();
  });
});
