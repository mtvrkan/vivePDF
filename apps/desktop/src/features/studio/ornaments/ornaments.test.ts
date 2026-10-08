import { describe, expect, it } from "vitest";
import en from "@/locales/en/common.json";
import { DEFAULT_COLOURS, ORNAMENTS, ornament } from "./ornaments";

const SIZES = [
  { width: 842, height: 595 },
  { width: 595, height: 842 },
  { width: 1080, height: 1080 },
  { width: 220, height: 842 },
  { width: 1684, height: 120 },
];

const MAX_PATH_DATA = 400_000;

function numbersOf(d: string): number[] {
  return (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
}

function built(id: string, size: { width: number; height: number }) {
  const item = ornament(id);
  if (!item) throw new Error(id);
  return item.build(DEFAULT_COLOURS, item.fitsPage ? size : item.size);
}

describe("ornaments", () => {
  it("has unique ids, a name for each and the patterns category", () => {
    const names = en.studio.ornaments.items as Record<string, string>;

    expect(new Set(ORNAMENTS.map((item) => item.id)).size).toBe(ORNAMENTS.length);
    for (const item of ORNAMENTS) expect(names[item.id], item.id).toBeTruthy();
    expect(ORNAMENTS.filter((item) => item.category === "patterns").length).toBeGreaterThanOrEqual(6);
  });

  it("draws finite paths that stay inside the view box at every page shape", () => {
    const problems = new Set<string>();
    for (const item of ORNAMENTS) {
      for (const size of item.fitsPage ? SIZES : [item.size]) {
        const art = built(item.id, size);
        if (art.paths.length === 0) problems.add(`${item.id}: no paths`);
        art.paths.forEach((path, pathIndex) => {
          const values = numbersOf(path.d);
          if (values.length === 0) problems.add(`${item.id}: empty path ${pathIndex}`);
          values.forEach((value, index) => {
            const limit = index % 2 === 0 ? art.viewWidth : art.viewHeight;
            if (!Number.isFinite(value) || value < -0.6 || value > limit + 0.6) problems.add(`${item.id} ${size.width}x${size.height} path ${pathIndex} ${index % 2 ? "y" : "x"}`);
          });
        });
      }
    }

    expect([...problems]).toEqual([]);
  });

  it("builds the same art every time so thumbnails and PDFs match the canvas", () => {
    for (const item of ORNAMENTS) {
      expect(built(item.id, SIZES[0]), item.id).toEqual(built(item.id, SIZES[0]));
    }
  });

  it("keeps every path under the renderer's limit at any page shape", () => {
    for (const item of ORNAMENTS.filter((entry) => entry.fitsPage)) {
      for (const size of [...SIZES, { width: 1191, height: 1684 }]) {
        const longest = Math.max(...built(item.id, size).paths.map((path) => path.d.length));
        expect(longest, `${item.id} ${size.width}x${size.height}`).toBeLessThan(MAX_PATH_DATA / 2);
      }
    }
  });
});
