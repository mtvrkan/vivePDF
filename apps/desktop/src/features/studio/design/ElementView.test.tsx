import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioTextElement } from "@/types/studio";
import { createDesign, createShape, createText } from "../model/design";
import { addElements, moveElements } from "../model/edit";
import { ElementView } from "./ElementView";
import { PageThumbnail } from "./PageThumbnail";
import { useStudioStore } from "./studioStore";

const fitted = vi.hoisted(() => vi.fn((_body: HTMLElement, element: { fontSize: number }) => element.fontSize));

vi.mock("./measure", async (original) => ({ ...(await original<typeof import("./measure")>()), fitTextSize: fitted }));

afterEach(() => {
  cleanup();
  fitted.mockClear();
  useStudioStore.getState().close();
});

describe("element view", () => {
  it("moves a shrink-to-fit text without measuring it again", () => {
    const text: StudioTextElement = { ...createText(10, 10, 120, 40, "Title"), autoSize: "shrink" };
    const view = render(<ElementView element={text} language="en" />);
    const measured = fitted.mock.calls.length;

    view.rerender(<ElementView element={{ ...text, x: 60, y: 30 }} language="en" />);

    expect(fitted.mock.calls.length).toBe(measured);
    expect((view.container.firstElementChild as HTMLElement).style.left).toBe("60px");
  });

  it("measures again once the box itself changes", () => {
    const text: StudioTextElement = { ...createText(10, 10, 120, 40, "Title"), autoSize: "shrink" };
    const view = render(<ElementView element={text} language="en" />);
    const measured = fitted.mock.calls.length;

    view.rerender(<ElementView element={{ ...text, width: 80 }} language="en" />);

    expect(fitted.mock.calls.length).toBeGreaterThan(measured);
  });
});

describe("page thumbnail", () => {
  it("holds the last picture while an element is dragged and catches up on release", () => {
    const design = createDesign("Card", 300, 200);
    const shape = createShape("rect", 10, 10, 50, 50);
    const page = addElements(design.pages[0], [shape]);
    useStudioStore.getState().open({ ...design, pages: [page] });
    const left = () => (view.container.querySelector(`[data-element-id="${shape.id}"]`) as HTMLElement).style.left;
    const view = render(<PageThumbnail page={page} language="en" scale={0.5} root={null} />);
    const moved = moveElements(page, [shape.id], 40, 0);

    act(() => useStudioStore.getState().setInteracting(true));
    view.rerender(<PageThumbnail page={moved} language="en" scale={0.5} root={null} />);
    expect(left()).toBe("10px");

    act(() => useStudioStore.getState().setInteracting(false));
    expect(left()).toBe("50px");
  });
});
