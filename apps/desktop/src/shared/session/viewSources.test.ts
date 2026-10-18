import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";

const releaseViewSource = vi.fn<(token: string) => Promise<void>>(() => Promise.resolve());
const openViewSource = vi.fn<(path: string) => Promise<{ token: string }>>(() => Promise.resolve({ token: "t-big" }));
const info = vi.fn();
const warn = vi.fn();

vi.mock("@/shared/rpc/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/rpc/files")>()),
  releaseViewSource: (token: string) => releaseViewSource(token),
  openViewSource: (path: string) => openViewSource(path),
  viewSourceUrl: (token: string) => `http://vivepdf-view.localhost/${token}`,
}));

vi.mock("@/shared/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/logger")>()),
  info: (...args: unknown[]) => info(...args),
  warn: (...args: unknown[]) => warn(...args),
}));

const { attachViewSource, rangeSource, releaseClosedViewSources, releaseViewSourceOf } = await import("./viewSources");

let stop: () => void;

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  stop = releaseClosedViewSources();
});

afterEach(() => {
  stop();
  releaseViewSourceOf("a");
  releaseViewSourceOf("copy");
  releaseViewSource.mockClear();
});

describe("releaseClosedViewSources", () => {
  it("lets go of a large document's view copy once its tab closes", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/scans/book.pdf", null);
    attachViewSource("a", "t-a");
    register("b", "C:/docs/b.pdf", null);

    remove("b");
    expect(releaseViewSource).not.toHaveBeenCalled();
    remove("a");

    expect(releaseViewSource).toHaveBeenCalledTimes(1);
    expect(releaseViewSource).toHaveBeenCalledWith("t-a");
  });

  it("keeps a copy whose document is still opening under a new id", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/scans/locked.pdf", null);
    attachViewSource("copy", "t-copy");

    remove("a");
    expect(releaseViewSource).not.toHaveBeenCalled();
    register("copy", "C:/scans/locked.pdf", "secret");
    remove("copy");

    expect(releaseViewSource).toHaveBeenCalledWith("t-copy");
  });

  it("releases a copy whose document never opened, once", () => {
    attachViewSource("copy", "t-failed");

    releaseViewSourceOf("copy");
    releaseViewSourceOf("copy");

    expect(releaseViewSource).toHaveBeenCalledTimes(1);
    expect(releaseViewSource).toHaveBeenCalledWith("t-failed");
  });
});

describe("rangeSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    info.mockClear();
    warn.mockClear();
  });

  it("serves a large file in ranges when the scheme answers a partial request and logs it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new Uint8Array([37]), { status: 206 }))));

    const source = await rangeSource("/Users/me/big.pdf");

    expect(source).toEqual({ kind: "range", url: "http://vivepdf-view.localhost/t-big", token: "t-big" });
    expect(info).toHaveBeenCalledWith("viewer", "large file opened in ranges");
    expect(releaseViewSource).not.toHaveBeenCalled();
  });

  it("logs the fallback and lets the copy go when the web view cannot reach the scheme", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Load failed"))));

    const source = await rangeSource("/Users/me/big.pdf");

    expect(source).toBeNull();
    expect(warn).toHaveBeenCalledWith("viewer", "range scheme unreachable, reading the whole file");
    expect(releaseViewSource).toHaveBeenCalledWith("t-big");
  });

  it("treats a whole-file answer as unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("%PDF", { status: 200 }))));

    expect(await rangeSource("/Users/me/big.pdf")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
