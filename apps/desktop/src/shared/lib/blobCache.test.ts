import { describe, expect, it } from "vitest";
import { createBlobCache } from "./blobCache";

describe("createBlobCache", () => {
  it("keeps the newest entries and frees the ones it drops", () => {
    const freed: string[] = [];
    const cache = createBlobCache(3, (url) => freed.push(url));
    for (const index of [1, 2, 3, 4, 5]) cache.remember(`k${index}`, `blob:${index}`);
    expect(cache.size()).toBe(3);
    expect(freed).toEqual(["blob:1", "blob:2"]);
    expect(cache.recall("k1")).toBeNull();
    expect(cache.recall("k5")).toBe("blob:5");
  });

  it("counts a recalled entry as recently used", () => {
    const freed: string[] = [];
    const cache = createBlobCache(2, (url) => freed.push(url));
    cache.remember("a", "blob:a");
    cache.remember("b", "blob:b");
    cache.recall("a");
    cache.remember("c", "blob:c");
    expect(freed).toEqual(["blob:b"]);
    expect(cache.recall("a")).toBe("blob:a");
  });

  it("never frees a thumbnail that is still on screen", () => {
    const freed: string[] = [];
    const cache = createBlobCache(2, (url) => freed.push(url));
    cache.remember("a", "blob:a");
    cache.retain("a");
    cache.remember("b", "blob:b");
    cache.remember("c", "blob:c");
    expect(freed).toEqual(["blob:b"]);
    expect(cache.size()).toBe(2);
    cache.release("a");
    cache.remember("d", "blob:d");
    expect(freed).toEqual(["blob:b", "blob:a"]);
  });

  it("keeps counting while the same thumbnail is shown twice", () => {
    const freed: string[] = [];
    const cache = createBlobCache(1, (url) => freed.push(url));
    cache.remember("a", "blob:a");
    cache.retain("a");
    cache.retain("a");
    cache.release("a");
    cache.remember("b", "blob:b");
    expect(freed).toEqual([]);
  });

  it("frees every picture of a closed document and nothing else", () => {
    const freed: string[] = [];
    const cache = createBlobCache(10, (url) => freed.push(url));
    cache.remember("doc-a:0:0.25", "blob:a0");
    cache.remember("doc-a:1:0.25", "blob:a1");
    cache.remember("doc-ab:0:0.25", "blob:ab0");
    cache.remember("doc-b:0:0.25", "blob:b0");
    expect(cache.forget("doc-a:")).toBe(2);
    expect(freed).toEqual(["blob:a0", "blob:a1"]);
    expect(cache.recall("doc-ab:0:0.25")).toBe("blob:ab0");
    expect(cache.size()).toBe(2);
  });
});
