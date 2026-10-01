import { afterEach, describe, expect, it, vi } from "vitest";
import { createFailureBatcher, createWatchLedger, signatureOf } from "./watchLedger";

afterEach(() => {
  vi.useRealTimers();
});

describe("watch ledger", () => {
  it("skips a file whose size and time did not change since it was processed", () => {
    const ledger = createWatchLedger();
    const event = { id: "a", path: "C:\\In\\scan.pdf", size: 10, modified: 5 };
    expect(ledger.alreadyDone("a", event)).toBe(false);
    ledger.markDone("a", event);
    expect(ledger.alreadyDone("a", { ...event, path: "c:/in/SCAN.pdf" })).toBe(true);
    expect(ledger.alreadyDone("a", { ...event, modified: 6 })).toBe(false);
    expect(ledger.alreadyDone("b", event)).toBe(false);
  });

  it("never skips a file it could not read the size of", () => {
    const ledger = createWatchLedger();
    const event = { id: "a", path: "C:/in/scan.pdf" };
    ledger.markDone("a", event);
    expect(signatureOf(event)).toBeNull();
    expect(ledger.alreadyDone("a", event)).toBe(false);
  });

  it("stops a file that travelled back to a rule that already handled it", () => {
    const ledger = createWatchLedger();
    ledger.recordOutput("a", "C:/in/scan.pdf", "C:/mid/scan.pdf");
    ledger.recordOutput("b", "C:/mid/scan.pdf", "C:/in/scan (2).pdf");
    expect(ledger.lineageOf("C:/in/scan (2).pdf")).toEqual(["a", "b"]);
    expect(ledger.loops("a", "C:/in/scan (2).pdf")).toBe(true);
    expect(ledger.loops("c", "C:/in/scan (2).pdf")).toBe(false);
    expect(ledger.loops("a", "C:/in/other.pdf")).toBe(false);
  });

  it("treats files inside a produced folder as produced", () => {
    const ledger = createWatchLedger();
    ledger.recordOutput("a", "C:/in/scan.pdf", "C:/out/scan-images");
    expect(ledger.loops("a", "C:/out/scan-images/page-1.pdf")).toBe(true);
  });

  it("forgets the oldest entries past its limit", () => {
    const ledger = createWatchLedger(2);
    for (const name of ["one", "two", "three"]) ledger.markDone("a", { id: "a", path: `C:/in/${name}.pdf`, size: 1, modified: 1 });
    expect(ledger.alreadyDone("a", { id: "a", path: "C:/in/one.pdf", size: 1, modified: 1 })).toBe(false);
    expect(ledger.alreadyDone("a", { id: "a", path: "C:/in/three.pdf", size: 1, modified: 1 })).toBe(true);
  });
});

describe("failure batcher", () => {
  it("reports failures that arrive together as one group", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = createFailureBatcher(flush, 100);
    batcher.add("a.pdf");
    batcher.add("b.pdf");
    vi.advanceTimersByTime(100);
    batcher.add("c.pdf");
    vi.advanceTimersByTime(100);
    expect(flush.mock.calls).toEqual([[["a.pdf", "b.pdf"]], [["c.pdf"]]]);
  });

  it("drops pending failures when disposed", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = createFailureBatcher(flush, 100);
    batcher.add("a.pdf");
    batcher.dispose();
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("persisted ledger", () => {
  it("remembers processed files across ledgers through its storage", () => {
    let saved: Array<[string, string]> = [];
    const storage = { load: () => saved, save: (entries: Array<[string, string]>) => (saved = entries) };
    const event = { id: "r", path: "C:/in/scan.pdf", size: 10, modified: 5 };
    createWatchLedger(10, storage).markDone("r", event);
    const reopened = createWatchLedger(10, storage);
    expect(reopened.alreadyDone("r", event)).toBe(true);
    expect(reopened.alreadyDone("r", { ...event, modified: 6 })).toBe(false);
  });

  it("keeps only the newest entries within the limit when loading", () => {
    const entries: Array<[string, string]> = [["r|c:/in/a.pdf", "1:1"], ["r|c:/in/b.pdf", "1:1"], ["r|c:/in/c.pdf", "1:1"]];
    const ledger = createWatchLedger(2, { load: () => entries, save: () => undefined });
    expect(ledger.alreadyDone("r", { id: "r", path: "C:/in/a.pdf", size: 1, modified: 1 })).toBe(false);
    expect(ledger.alreadyDone("r", { id: "r", path: "C:/in/c.pdf", size: 1, modified: 1 })).toBe(true);
  });
});
