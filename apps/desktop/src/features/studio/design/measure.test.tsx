import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createText } from "../model/design";

vi.mock("@/shared/rpc/operations", () => ({ fontFile: async () => ({ ext: "pfb", base64: "", italic: false }) }));

const { measureTexts } = await import("./measure");

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
