import { describe, expect, it } from "vitest";
import { intersectsLens, lensRegion, placeInLens, svgSnapshotMarkup } from "./lensComposition";

describe("lens composition", () => {
  it("centres the sampled region on the pointer", () => {
    expect(lensRegion(500, 300, 200, 2)).toEqual({ left: 450, top: 250, zoom: 2 });
  });

  it("places every layer by the same transform, so page, annotations and ink line up", () => {
    const region = lensRegion(500, 300, 200, 2);
    const page = { left: 400, top: 100, width: 600, height: 800 };
    const annotation = { left: 480, top: 280, width: 40, height: 20 };
    expect(placeInLens(page, region)).toEqual([-100, -300, 1200, 1600]);
    expect(placeInLens(annotation, region)).toEqual([60, 60, 80, 40]);
  });

  it("skips layers that fall outside the lens", () => {
    const region = lensRegion(500, 300, 200, 2);
    expect(intersectsLens({ left: 900, top: 900, width: 40, height: 40 }, region, 200)).toBe(false);
    expect(intersectsLens({ left: 480, top: 280, width: 40, height: 20 }, region, 200)).toBe(true);
    expect(intersectsLens({ left: 480, top: 280, width: 0, height: 20 }, region, 200)).toBe(false);
  });

  it("sizes an annotation svg snapshot to its on-screen box", () => {
    const url = svgSnapshotMarkup('<svg width="10" height="10" viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/></svg>', 120, 80);
    const markup = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(markup.startsWith('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" width="120" height="80">')).toBe(true);
    expect(markup).toContain('<rect width="5" height="5" fill="red"/>');
  });

  it("keeps an existing namespace", () => {
    const url = svgSnapshotMarkup('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', 5, 6);
    const markup = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
    expect(markup.match(/xmlns=/g)).toHaveLength(1);
  });
});
