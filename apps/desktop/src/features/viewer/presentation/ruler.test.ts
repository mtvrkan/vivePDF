import { beforeEach, describe, expect, it } from "vitest";
import { usePresentationStore, type RulerState } from "@/shared/store/presentationStore";
import { nearRulerEdge, normalizeAngle, rotateRuler, rulerEdge, rulerLengthCm, snapAngle, snapToRuler } from "./ruler";
import type { PageRect } from "./usePageRects";

const POINTS_PER_CM = 72 / 2.54;
const PAGE: PageRect = { pageIndex: 0, left: 100, top: 50, width: 800, height: 400 };
const RULER: RulerState = { pageIndex: 0, x: 0.1, y: 0.5, angle: 0, pageWidthPt: 600 };

beforeEach(() => usePresentationStore.getState().resetSession());

describe("rulerEdge", () => {
  it("scales real centimetres to the page on screen", () => {
    const edge = rulerEdge([PAGE], RULER)!;

    expect(edge.origin).toEqual({ x: 180, y: 250 });
    expect(edge.pxPerCm).toBeCloseTo((800 / 600) * POINTS_PER_CM);
    expect(edge.lengthCm).toBe(rulerLengthCm(600));
    expect(edge.length).toBeCloseTo(edge.lengthCm * edge.pxPerCm);
  });

  it("is missing when the ruler's page is not on screen", () => {
    expect(rulerEdge([PAGE], { ...RULER, pageIndex: 4 })).toBeNull();
    expect(rulerEdge([PAGE], null)).toBeNull();
  });

  it("never gets shorter than ten centimetres", () => {
    expect(rulerLengthCm(100)).toBe(10);
    expect(rulerLengthCm(POINTS_PER_CM * 21)).toBe(21);
  });
});

describe("ruler guide", () => {
  const edge = rulerEdge([PAGE], RULER)!;

  it("catches a pen that starts just above the edge but not one far away or past the end", () => {
    expect(nearRulerEdge(edge, { x: 300, y: 240 })).toBe(true);
    expect(nearRulerEdge(edge, { x: 300, y: 200 })).toBe(false);
    expect(nearRulerEdge(edge, { x: 300, y: 270 })).toBe(false);
    expect(nearRulerEdge(edge, { x: 100, y: 245 })).toBe(false);
  });

  it("lays points on the edge, kept clear of the ruler body", () => {
    expect(snapToRuler(edge, { x: 320, y: 233 }, 2)).toEqual({ x: 320, y: 248 });
    const turned = rulerEdge([PAGE], { ...RULER, angle: 90 })!;
    const point = snapToRuler(turned, { x: 170, y: 300 }, 0);
    expect(point.x).toBeCloseTo(180);
    expect(point.y).toBeCloseTo(300);
  });
});

describe("ruler angles", () => {
  it("wraps into one turn", () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
  });

  it("clicks onto 45° when close and steps by 15° with Shift", () => {
    expect(snapAngle(43.5, false)).toBe(45);
    expect(snapAngle(30.26, false)).toBe(30.3);
    expect(snapAngle(37, true)).toBe(30);
  });

  it("turns by whole steps from the buttons", () => {
    expect(rotateRuler({ ...RULER, angle: 7 }, 15).angle).toBe(15);
    expect(rotateRuler({ ...RULER, angle: 180 }, 15).angle).toBe(-165);
  });
});

describe("toggleRuler", () => {
  it("shows the ruler on the page and hides it again, and a new session starts without it", () => {
    usePresentationStore.getState().toggleRuler(2, 595);
    expect(usePresentationStore.getState().ruler).toMatchObject({ pageIndex: 2, angle: 0, pageWidthPt: 595 });

    usePresentationStore.getState().toggleRuler(2, 595);
    expect(usePresentationStore.getState().ruler).toBeNull();

    usePresentationStore.getState().toggleRuler(0, 595);
    usePresentationStore.getState().resetSession();
    expect(usePresentationStore.getState().ruler).toBeNull();
  });
});
