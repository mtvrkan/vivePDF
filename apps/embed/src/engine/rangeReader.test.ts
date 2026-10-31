import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeReader, syncRangeRequest, type RangeLimits } from "./rangeReader";

const LIMITS: RangeLimits = { blockBytes: 16, readAheadBytes: 64, requestBytes: 128, cacheBytes: 96, wholeFileBytes: 200 };

function fakeFile(length: number, options: { ignoreRanges?: boolean } = {}) {
  const content = Uint8Array.from({ length }, (_, index) => index % 251);
  const requests: [number, number][] = [];
  const fetchRange = (start: number, end: number) => {
    requests.push([start, end]);
    if (options.ignoreRanges) return { bytes: content.slice(), total: length, whole: true };
    return { bytes: content.slice(start, Math.min(end, length - 1) + 1), total: length, whole: false };
  };
  return { content, requests, fetchRange };
}

function readBytes(reader: RangeReader, position: number, size: number): Uint8Array | null {
  const heap = new Uint8Array(size + 8);
  return reader.read(position, size, () => heap, 8) ? heap.slice(8) : null;
}

describe("RangeReader", () => {
  it("answers reads with the file's bytes and fetches each scattered spot as one small block", () => {
    const file = fakeFile(1000);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    const tail = readBytes(reader, 990, 10);
    const middle = readBytes(reader, 500, 4);

    expect(tail).toEqual(file.content.slice(990, 1000));
    expect(middle).toEqual(file.content.slice(500, 504));
    expect(file.requests).toEqual([
      [0, 31],
      [976, 999],
      [496, 511],
    ]);
  });

  it("reads further ahead while reads keep moving forward", () => {
    const file = fakeFile(1000);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    for (let position = 32; position < 300; position += 16) readBytes(reader, position, 16);

    expect(file.requests.slice(1).map(([start, end]) => end - start + 1)).toEqual([32, 64, 64, 64, 64]);
  });

  it("fetches a long read in one request and splits it only at the request limit", () => {
    const file = fakeFile(1000);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    const bytes = readBytes(reader, 600, 300);

    expect(bytes).toEqual(file.content.slice(600, 900));
    expect(file.requests.slice(1)).toEqual([
      [592, 719],
      [720, 847],
      [848, 911],
    ]);
  });

  it("keeps only the cache budget and fetches dropped blocks again", () => {
    const file = fakeFile(1000);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    for (const position of [100, 200, 300, 400, 500, 700, 900]) readBytes(reader, position, 1);
    readBytes(reader, 100, 1);

    expect(reader.cachedSize).toBeLessThanOrEqual(LIMITS.cacheBytes);
    expect(file.requests.at(-1)).toEqual([96, 111]);
  });

  it("downloads a small file in two requests and reads it from memory", () => {
    const file = fakeFile(150);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    const bytes = readBytes(reader, 100, 50);

    expect(bytes).toEqual(file.content.slice(100, 150));
    expect(file.requests).toEqual([
      [0, 31],
      [32, 149],
    ]);
  });

  it("uses the whole answer of a server that ignores ranges without asking again", () => {
    const file = fakeFile(500, { ignoreRanges: true });
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    const bytes = readBytes(reader, 400, 100);

    expect(bytes).toEqual(file.content.slice(400, 500));
    expect(reader.length).toBe(500);
    expect(file.requests).toHaveLength(1);
  });

  it("refuses reads past the end of the file", () => {
    const file = fakeFile(100);
    const reader = RangeReader.open(file.fetchRange, LIMITS);

    expect(readBytes(reader, 90, 20)).toBeNull();
    expect(reader.read(0, 0, () => new Uint8Array(0), 0)).toBe(true);
  });

  it("fails when the file changes size while it is open", () => {
    const file = fakeFile(1000);
    const reader = RangeReader.open((start, end) => ({ ...file.fetchRange(start, end), total: start === 0 ? 1000 : 900 }), LIMITS);

    const read = () => readBytes(reader, 600, 4);

    expect(read).toThrow("the file changed while it was open");
  });
});

function stubRequest(status: number, body: Uint8Array, contentRange: string | null): void {
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = status;
      response = body.buffer;
      responseType = "";
      open(): void {}
      setRequestHeader(): void {}
      send(): void {}
      getResponseHeader(name: string): string | null {
        return name === "Content-Range" ? contentRange : null;
      }
    },
  );
}

describe("syncRangeRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a partial answer with the file's total size", () => {
    stubRequest(206, Uint8Array.from([1, 2, 3, 4]), "bytes 0-3/1000");

    const answer = syncRangeRequest("/file.pdf")(0, 3);

    expect(answer).toEqual({ bytes: Uint8Array.from([1, 2, 3, 4]), total: 1000, whole: false });
  });

  it("reads a range the server cannot satisfy at the first byte as an empty file", () => {
    stubRequest(416, new Uint8Array(0), null);

    const answer = syncRangeRequest("/empty.pdf")(0, 65535);

    expect(answer).toEqual({ bytes: new Uint8Array(0), total: 0, whole: true });
  });

  it("fails on a range the server cannot satisfy past the first byte", () => {
    stubRequest(416, new Uint8Array(0), "bytes */1000");

    const pastStart = () => syncRangeRequest("/file.pdf")(2000, 2100);

    expect(pastStart).toThrow("range request answered 416");
  });

  it("fails on a server error", () => {
    stubRequest(500, new Uint8Array(0), null);

    const failed = () => syncRangeRequest("/file.pdf")(0, 100);

    expect(failed).toThrow("range request answered 500");
  });
});
