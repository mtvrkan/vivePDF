import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CurrentPageMask } from "./CurrentPageMask";

const rects = [
  { pageIndex: 3, left: 200, top: 0, width: 980, height: 735 },
  { pageIndex: 4, left: 200, top: 751, width: 980, height: 735 },
];

describe("CurrentPageMask", () => {
  afterEach(cleanup);

  it("covers everything around the shown page so the next one does not peek in", () => {
    render(<CurrentPageMask rects={rects} pageIndex={3} />);

    const [top, bottom, left, right] = Array.from(screen.getByTestId("current-page-mask").children) as HTMLElement[];
    expect(top.style.height).toBe("0px");
    expect(bottom.style.top).toBe("735px");
    expect(left.style.width).toBe("200px");
    expect(right.style.left).toBe("1180px");
    expect(bottom.className).toContain("bg-black");
  });

  it("draws nothing before the shown page is measured", () => {
    render(<CurrentPageMask rects={rects} pageIndex={9} />);

    expect(screen.queryByTestId("current-page-mask")).toBeNull();
  });
});
