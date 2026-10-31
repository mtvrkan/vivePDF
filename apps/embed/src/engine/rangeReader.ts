export type RangeAnswer = { bytes: Uint8Array; total: number; whole: boolean };
export type FetchRange = (start: number, end: number) => RangeAnswer;
export type RangeLimits = { blockBytes: number; readAheadBytes: number; requestBytes: number; cacheBytes: number; wholeFileBytes: number };

export const RANGE_LIMITS: RangeLimits = {
  blockBytes: 32 * 1024,
  readAheadBytes: 1024 * 1024,
  requestBytes: 8 * 1024 * 1024,
  cacheBytes: 16 * 1024 * 1024,
  wholeFileBytes: 2 * 1024 * 1024,
};

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const RANGE_NOT_SATISFIABLE = 416;

export function syncRangeRequest(url: string): FetchRange {
  return (start, end) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.responseType = "arraybuffer";
    request.setRequestHeader("Range", `bytes=${start}-${end}`);
    request.send();
    const bytes = new Uint8Array(request.response as ArrayBuffer);
    if (request.status === 200) return { bytes, total: bytes.length, whole: true };
    if (request.status === RANGE_NOT_SATISFIABLE && start === 0) return { bytes: new Uint8Array(0), total: 0, whole: true };
    if (request.status !== 206) throw new Error(`range request answered ${request.status}`);
    const match = CONTENT_RANGE.exec(request.getResponseHeader("Content-Range") ?? "");
    if (!match || Number(match[1]) !== start || bytes.length !== Number(match[2]) - start + 1) throw new Error("range request answered the wrong bytes");
    return { bytes, total: Number(match[3]), whole: false };
  };
}

export class RangeReader {
  readonly length: number;
  private readonly fetchRange: FetchRange;
  private readonly limits: RangeLimits;
  private readonly blocks = new Map<number, Uint8Array>();
  private whole: Uint8Array | null = null;
  private cachedBytes = 0;
  private lastFetched = -1;
  private readAheadBlocks = 1;

  private constructor(length: number, fetchRange: FetchRange, limits: RangeLimits) {
    this.length = length;
    this.fetchRange = fetchRange;
    this.limits = limits;
  }

  static open(fetchRange: FetchRange, limits: RangeLimits = RANGE_LIMITS): RangeReader {
    const first = fetchRange(0, 2 * limits.blockBytes - 1);
    const reader = new RangeReader(first.total, fetchRange, limits);
    if (first.whole || first.bytes.length === first.total) reader.whole = first.bytes;
    else if (first.total <= limits.wholeFileBytes) reader.whole = RangeReader.rest(fetchRange, first);
    else {
      reader.store(0, first.bytes);
      reader.lastFetched = Math.ceil(first.bytes.length / limits.blockBytes) - 1;
    }
    return reader;
  }

  private static rest(fetchRange: FetchRange, first: RangeAnswer): Uint8Array {
    const rest = fetchRange(first.bytes.length, first.total - 1);
    if (rest.whole) return rest.bytes;
    if (rest.total !== first.total || rest.bytes.length !== first.total - first.bytes.length) throw new Error("the file changed while it was open");
    const whole = new Uint8Array(first.total);
    whole.set(first.bytes);
    whole.set(rest.bytes, first.bytes.length);
    return whole;
  }

  read(position: number, size: number, heap: () => Uint8Array, target: number): boolean {
    if (size === 0) return true;
    if (position < 0 || position + size > this.length) return false;
    if (this.whole) {
      heap().set(this.whole.subarray(position, position + size), target);
      return true;
    }
    const block = this.limits.blockBytes;
    const firstIndex = Math.floor(position / block);
    const lastIndex = Math.floor((position + size - 1) / block);
    const wanted: Uint8Array[] = [];
    for (let index = firstIndex; index <= lastIndex; ) {
      const cached = this.blocks.get(index);
      if (cached) {
        wanted.push(cached);
        index += 1;
        continue;
      }
      const fetched = this.fetchMiss(index, lastIndex);
      for (let offset = 0; offset < fetched.length && index + offset <= lastIndex; offset += 1) wanted.push(fetched[offset]);
      index += fetched.length;
    }
    let written = 0;
    wanted.forEach((bytes, offset) => {
      const index = firstIndex + offset;
      const from = index === firstIndex ? position - index * block : 0;
      const to = Math.min(bytes.length, position + size - index * block);
      heap().set(bytes.subarray(from, to), target + written);
      written += to - from;
      this.touch(index, bytes);
    });
    this.evict();
    return written === size;
  }

  private fetchMiss(index: number, lastNeeded: number): Uint8Array[] {
    const block = this.limits.blockBytes;
    const lastBlock = Math.ceil(this.length / block) - 1;
    const sequential = index > this.lastFetched && index <= this.lastFetched + this.readAheadBlocks;
    this.readAheadBlocks = sequential ? Math.min(this.readAheadBlocks * 2, Math.max(1, this.limits.readAheadBytes / block)) : 1;
    const maxBlocks = Math.max(1, Math.floor(this.limits.requestBytes / block));
    let end = index;
    while (end < lastBlock && end - index + 1 < maxBlocks && !this.blocks.has(end + 1) && (end < lastNeeded || end - index + 1 < this.readAheadBlocks)) end += 1;
    const start = index * block;
    const stop = Math.min(this.length, (end + 1) * block) - 1;
    const answer = this.fetchRange(start, stop);
    if (answer.total !== this.length) throw new Error("the file changed while it was open");
    if (answer.bytes.length !== stop - start + 1) throw new Error("range request answered the wrong bytes");
    const fetched: Uint8Array[] = [];
    for (let current = index; current <= end; current += 1) {
      const offset = (current - index) * block;
      const bytes = answer.bytes.slice(offset, Math.min(answer.bytes.length, offset + block));
      fetched.push(bytes);
      this.store(current, bytes);
    }
    this.lastFetched = end;
    return fetched;
  }

  private store(index: number, bytes: Uint8Array): void {
    const block = this.limits.blockBytes;
    for (let offset = 0; offset < bytes.length; offset += block) this.touch(index + offset / block, bytes.subarray(offset, Math.min(bytes.length, offset + block)));
  }

  private touch(index: number, bytes: Uint8Array): void {
    const previous = this.blocks.get(index);
    if (previous) this.cachedBytes -= previous.length;
    this.blocks.delete(index);
    this.blocks.set(index, bytes);
    this.cachedBytes += bytes.length;
  }

  private evict(): void {
    for (const [index, bytes] of this.blocks) {
      if (this.cachedBytes <= this.limits.cacheBytes) return;
      this.blocks.delete(index);
      this.cachedBytes -= bytes.length;
    }
  }

  get cachedSize(): number {
    return this.whole ? this.whole.length : this.cachedBytes;
  }
}

export function openRangeReader(url: string): RangeReader {
  return RangeReader.open(syncRangeRequest(url));
}
