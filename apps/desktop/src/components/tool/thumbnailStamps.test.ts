import { describe, expect, it, vi } from "vitest";
import { STAMP_CHECK_MS, createThumbnailStamps } from "./thumbnailStamps";

describe("createThumbnailStamps", () => {
  it("moves a file to a new generation when its stamp changes and tells listeners", () => {
    const stamps = createThumbnailStamps();
    const listener = vi.fn();
    stamps.subscribe(listener);

    stamps.note("/a.pdf", "1-10");
    stamps.note("/a.pdf", "1-10");
    stamps.note("/a.pdf", "2-12");

    expect(stamps.generation("/a.pdf")).toBe(1);
    expect(stamps.generation("/b.pdf")).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty stamp from an engine that cannot read the file", () => {
    const stamps = createThumbnailStamps();

    stamps.note("/a.pdf", "1-10");
    stamps.note("/a.pdf", "");
    stamps.note("/a.pdf", undefined);
    stamps.note("/a.pdf", "1-10");

    expect(stamps.generation("/a.pdf")).toBe(0);
  });

  it("asks for one check per file at most every interval", () => {
    let time = 1000;
    const stamps = createThumbnailStamps(() => time);

    const first = stamps.needsCheck("/a.pdf");
    const rightAfter = stamps.needsCheck("/a.pdf");
    time += STAMP_CHECK_MS;
    const later = stamps.needsCheck("/a.pdf");
    stamps.note("/b.pdf", "1-1");
    const justLoaded = stamps.needsCheck("/b.pdf");

    expect([first, rightAfter, later, justLoaded]).toEqual([true, false, true, false]);
  });
});
