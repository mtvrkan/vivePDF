import { afterEach, describe, expect, it } from "vitest";
import { steppedZoom, useDocumentViewStore, zoomPercent } from "./documentView";

describe("document zoom", () => {
  afterEach(() => {
    localStorage.clear();
    useDocumentViewStore.setState({ zoom: "width" });
  });

  it("steps from a fitted zoom to the next listed percentage either way", () => {
    expect(steppedZoom(0.93, 1)).toBe(100);

    expect(steppedZoom(0.93, -1)).toBe(90);
    expect(zoomPercent(0.934)).toBe(93);
  });

  it("stays at the ends of the list", () => {
    expect(steppedZoom(2, 1)).toBe(200);

    expect(steppedZoom(0.4, -1)).toBe(50);
  });

  it("remembers the chosen zoom", () => {
    useDocumentViewStore.getState().setZoom(150);

    expect(useDocumentViewStore.getState().zoom).toBe(150);
    expect(localStorage.getItem("vivepdf.documentZoom")).toBe("150");
  });
});
