import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioDesign, StudioTextElement } from "@/types/studio";
import { createDesign, createShape, createText } from "../model/design";

const built = vi.hoisted(() => ({ count: 0 }));

vi.mock("../design/measure", () => ({
  buildTextNode: () => {
    built.count += 1;
    const frame = document.createElement("div");
    const body = document.createElement("div");
    frame.append(body);
    return { frame, body };
  },
}));

const { domMeasure, keepUnchanged } = await import("./cvRender");
const { useStudioFontsStore } = await import("../design/fonts");

function cv(lines: string[]): StudioDesign {
  const design = createDesign("CV", 595, 842);
  return { ...design, pages: [{ ...design.pages[0], elements: [createShape("rect", 0, 0, 595, 80), ...lines.map((line, index) => createText(40, 100 + index * 30, 300, 20, line))] }] };
}

afterEach(() => {
  built.count = 0;
  useStudioFontsStore.setState({ faces: {} });
});

describe("cv preview identity", () => {
  it("gives elements and pages ids that survive a new compose", () => {
    const first = keepUnchanged(cv(["Ada", "Engineer"]), null);
    const second = keepUnchanged(cv(["Ada", "Engineer"]), first);

    expect(first.pages[0].id).toBe("cv-page-0");
    expect(first.pages[0].elements.map((element) => element.id)).toEqual(["cv-0-0", "cv-0-1", "cv-0-2"]);
    expect(second.pages[0]).toBe(first.pages[0]);
  });

  it("swaps only the element whose text changed", () => {
    const first = keepUnchanged(cv(["Ada", "Engineer"]), null);

    const second = keepUnchanged(cv(["Ada Lovelace", "Engineer"]), first);

    expect(second.pages[0]).not.toBe(first.pages[0]);
    expect(second.pages[0].elements[0]).toBe(first.pages[0].elements[0]);
    expect(second.pages[0].elements[1]).not.toBe(first.pages[0].elements[1]);
    expect(second.pages[0].elements[2]).toBe(first.pages[0].elements[2]);
  });

  it("starts fresh pages when the CV grows a page", () => {
    const first = keepUnchanged(cv(["Ada"]), null);
    const longer = cv(["Ada"]);

    const second = keepUnchanged({ ...longer, pages: [...longer.pages, { ...longer.pages[0] }] }, first);

    expect(second.pages.map((page) => page.id)).toEqual(["cv-page-0", "cv-page-1"]);
    expect(second.pages[1].elements[0].id).toBe("cv-1-0");
  });
});

describe("cv text measuring", () => {
  const line = createText(0, 0, 200, 20, "Senior engineer") as StudioTextElement;

  it("measures a line once across renders", () => {
    const first = domMeasure("en");
    first.measure(line);
    first.dispose();
    const second = domMeasure("en");
    second.measure(line);
    second.dispose();

    expect(built.count).toBe(1);
  });

  it("measures again for another language or a narrower box", () => {
    const tool = domMeasure("en");
    tool.measure(line);
    tool.measure({ ...line, width: 120 });
    tool.dispose();
    const turkish = domMeasure("tr");
    turkish.measure(line);
    turkish.dispose();

    expect(built.count).toBeGreaterThanOrEqual(3);
  });

  it("forgets the heights once a font finishes loading", () => {
    const tool = domMeasure("en");
    tool.measure(line);
    const before = built.count;

    useStudioFontsStore.setState({ faces: { "library:x|400|0": null } });
    tool.measure(line);
    tool.dispose();

    expect(built.count).toBe(before + 1);
  });
});
