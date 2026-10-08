import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createText } from "../model/design";

vi.mock("@/shared/rpc/operations", () => ({ fontFile: async () => ({ ext: "pfb", base64: "", italic: false }) }));

const { fitTextSize, measureTexts } = await import("./measure");

const texts = (count: number) => Array.from({ length: count }, (_, index) => createText(0, index * 20, 200, 20, `Line ${index}`));

let channels = 0;

beforeEach(() => {
  channels = 0;
  const Real = MessageChannel;
  vi.stubGlobal(
    "MessageChannel",
    class extends Real {
      constructor() {
        super();
        channels += 1;
      }
    },
  );
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("measuring texts for rendering", () => {
  it("measures every text of the page", async () => {
    const measured = await measureTexts(texts(3), "en");

    expect([...measured.keys()]).toHaveLength(3);
  });

  it("hands the main thread back while a long page is measured", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 20));

    const measured = await measureTexts(texts(5), "en");

    expect(measured.size).toBe(5);
    expect(channels).toBeGreaterThanOrEqual(4);
  });

  it("skips empty and hidden texts", async () => {
    const [shown, hidden] = texts(2);

    const measured = await measureTexts([shown, { ...hidden, hidden: true }, createText(0, 0, 10, 10, "  ")], "en");

    expect([...measured.keys()]).toEqual([shown.id]);
  });
});

describe("shrinking text to its box", () => {
  it("keeps shrinking while the wrapped layout is still too tall", () => {
    const body = document.createElement("div");
    body.style.overflowWrap = "break-word";
    const size = () => Number.parseFloat(body.style.fontSize);
    Object.defineProperty(body, "scrollWidth", { get: () => size() * 2 });
    Object.defineProperty(body, "offsetHeight", { get: () => (body.style.overflowWrap === "break-word" && size() > 50 ? size() * 2 : size()) });

    const fitted = fitTextSize(body, createText(0, 0, 120, 70, "MAISON", { fontSize: 60, autoSize: "shrink" }));

    expect(fitted).toBe(50);
    expect(body.style.overflowWrap).toBe("break-word");
    expect(body.style.fontSize).toBe("50px");
  });
});
