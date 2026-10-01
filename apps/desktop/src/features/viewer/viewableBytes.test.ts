import { beforeEach, describe, expect, it, vi } from "vitest";

const readDocumentBytes = vi.fn<(path: string) => Promise<ArrayBuffer>>();
const openViewSource = vi.fn<(path: string) => Promise<{ token: string; length: number } | null>>();
const releaseViewSource = vi.fn<(token: string) => Promise<void>>(() => Promise.resolve());
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<{ status: number }>>();
const prepareView = vi.fn();
const restoreView = vi.fn();

vi.stubGlobal("fetch", (url: string, init: RequestInit) => fetchMock(url, init));
vi.mock("@/shared/rpc/files", () => ({
  readDocumentBytes: (path: string) => readDocumentBytes(path),
  openViewSource: (path: string) => openViewSource(path),
  releaseViewSource: (token: string) => releaseViewSource(token),
  viewSourceUrl: (token: string) => `http://vivepdf-view.localhost/${token}`,
}));
vi.mock("@/shared/rpc/operations", () => ({
  prepareView: (...args: unknown[]) => prepareView(...args),
  restoreView: (...args: unknown[]) => restoreView(...args),
}));

const { preparedViewSource, readViewableSource, restoreSavedView, usesDisplayFonts, usesLayerView } = await import("./viewableBytes");
const { closeViewable, openViewable, readOriginalSource, releaseViewSourceOf } = await import("@/shared/session/viewSources");

async function readViewableBytes(path: string): Promise<ArrayBuffer> {
  const source = await readViewableSource(path);
  if (source.kind !== "buffer") throw new Error(`expected bytes, got ${source.url}`);
  return source.buffer;
}

async function preparedViewBytes(path: string, password?: string, layers: { id: number; on: boolean }[] = []): Promise<ArrayBuffer | null> {
  const source = await preparedViewSource(path, password, layers);
  if (source && source.kind !== "buffer") throw new Error(`expected bytes, got ${source.url}`);
  return source?.buffer ?? null;
}

const bytesOf = (label: string) => new TextEncoder().encode(label).buffer as ArrayBuffer;

describe("readViewableBytes", () => {
  beforeEach(() => {
    readDocumentBytes.mockReset();
    prepareView.mockReset();
    restoreView.mockReset();
    openViewSource.mockReset();
    releaseViewSource.mockClear();
    fetchMock.mockReset();
    readDocumentBytes.mockImplementation(async (path) => bytesOf(path));
    openViewSource.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ status: 206 });
  });

  it("reads the file itself when its annotation names are already unique", async () => {
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0 });
    expect(new TextDecoder().decode(await readViewableBytes("a.pdf"))).toBe("a.pdf");
  });

  it("reads the renamed copy when the engine made one", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 2 });
    expect(new TextDecoder().decode(await readViewableBytes("a.pdf"))).toBe("copy.pdf");
  });

  it("falls back to the file when the engine fails or the copy cannot be read", async () => {
    prepareView.mockRejectedValue(new Error("busy"));
    expect(new TextDecoder().decode(await readViewableBytes("a.pdf"))).toBe("a.pdf");
    prepareView.mockResolvedValue({ viewPath: "gone.pdf", renamed: 1 });
    readDocumentBytes.mockImplementation(async (path) => {
      if (path === "gone.pdf") throw new Error("missing");
      return bytesOf(path);
    });
    expect(new TextDecoder().decode(await readViewableBytes("a.pdf"))).toBe("a.pdf");
  });

  it("checks a locked file with the password the user typed", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 3 });
    const bytes = await preparedViewBytes("locked.pdf", "secret");
    expect(new TextDecoder().decode(bytes ?? new ArrayBuffer(0))).toBe("copy.pdf");
    expect(prepareView.mock.calls[0][0]).toEqual({ path: "locked.pdf", password: "secret" });
  });

  it("gives nothing back when a locked file needs no copy or the check fails", async () => {
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0 });
    expect(await preparedViewBytes("locked.pdf", "secret")).toBeNull();
    prepareView.mockRejectedValue(new Error("NEEDS_PASSWORD"));
    expect(await preparedViewBytes("locked.pdf", "wrong")).toBeNull();
  });

  it("remembers a copy with display fonts and restores them after a save", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 0, fonts: 2 });
    await readViewableBytes("arabic.pdf");
    expect(usesDisplayFonts("arabic.pdf")).toBe(true);
    restoreView.mockResolvedValue({ restored: 4 });
    await restoreSavedView("arabic.pdf", "saved.pdf", "secret");
    expect(restoreView).toHaveBeenCalledWith({ path: "saved.pdf", password: "secret" });
  });

  it("skips the restore when the view copy only renamed annotations or was not used", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 2, fonts: 0 });
    await readViewableBytes("notes.pdf");
    expect(usesDisplayFonts("notes.pdf")).toBe(false);
    await restoreSavedView("notes.pdf", "notes.pdf");
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 0, fonts: 1 });
    readDocumentBytes.mockImplementation(async (path) => {
      if (path === "copy.pdf") throw new Error("missing");
      return bytesOf(path);
    });
    await readViewableBytes("hebrew.pdf");
    expect(usesDisplayFonts("hebrew.pdf")).toBe(false);
    await restoreSavedView("hebrew.pdf", "hebrew.pdf");
    expect(restoreView).not.toHaveBeenCalled();
  });

  it("asks for the chosen layers with a longer wait and restores them after a save", async () => {
    prepareView.mockResolvedValue({ viewPath: "layers.pdf", renamed: 0, fonts: 0, layers: 1 });
    const bytes = await preparedViewBytes("plan.pdf", undefined, [{ id: 12, on: false }]);
    expect(new TextDecoder().decode(bytes as ArrayBuffer)).toBe("layers.pdf");
    expect(prepareView.mock.calls[0][0]).toEqual({ path: "plan.pdf", layers: [{ id: 12, on: false }] });
    expect(usesLayerView("plan.pdf")).toBe(true);
    expect(usesDisplayFonts("plan.pdf")).toBe(false);
    restoreView.mockResolvedValue({ restored: 1 });
    await restoreSavedView("plan.pdf", "plan copy.pdf");
    expect(restoreView).toHaveBeenCalledWith({ path: "plan copy.pdf" });
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0, fonts: 0 });
    await readViewableBytes("plan.pdf");
    expect(usesLayerView("plan.pdf")).toBe(false);
  });

  it("forgets display fonts when a reopened file no longer needs a copy", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 0, fonts: 1 });
    await readViewableBytes("mixed.pdf");
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0, fonts: 0 });
    await readViewableBytes("mixed.pdf");
    expect(usesDisplayFonts("mixed.pdf")).toBe(false);
  });

  it("reads a large file in ranges through a view source instead of loading it", async () => {
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0, fonts: 0 });
    openViewSource.mockResolvedValue({ token: "t-1", length: 300_000_000 });

    const source = await readViewableSource("scan.pdf");

    expect(source).toEqual({ kind: "range", url: "http://vivepdf-view.localhost/t-1", token: "t-1" });
    expect(openViewSource).toHaveBeenCalledWith("scan.pdf");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: "bytes=0-0" });
    expect(readDocumentBytes).not.toHaveBeenCalled();
  });

  it("serves a large renamed copy in ranges and still remembers its display fonts", async () => {
    prepareView.mockResolvedValue({ viewPath: "copy.pdf", renamed: 0, fonts: 2 });
    openViewSource.mockImplementation(async (path) => (path === "copy.pdf" ? { token: "t-2", length: 90_000_000 } : null));

    const source = await preparedViewSource("big-arabic.pdf", "secret");

    expect(source).toMatchObject({ kind: "range", token: "t-2" });
    expect(usesDisplayFonts("big-arabic.pdf")).toBe(true);
    expect(prepareView.mock.calls[0][0]).toEqual({ path: "big-arabic.pdf", password: "secret" });
  });

  it("falls back to reading the bytes when the view source cannot be reached or made", async () => {
    prepareView.mockResolvedValue({ viewPath: null, renamed: 0, fonts: 0 });
    openViewSource.mockResolvedValue({ token: "t-3", length: 300_000_000 });
    fetchMock.mockResolvedValue({ status: 403 });
    expect(new TextDecoder().decode(await readViewableBytes("linux.pdf"))).toBe("linux.pdf");
    expect(releaseViewSource).toHaveBeenCalledWith("t-3");

    fetchMock.mockRejectedValue(new TypeError("blocked by CSP"));
    expect(new TextDecoder().decode(await readViewableBytes("csp.pdf"))).toBe("csp.pdf");

    openViewSource.mockRejectedValue(new Error("not enough free disk space"));
    expect(new TextDecoder().decode(await readViewableBytes("full-disk.pdf"))).toBe("full-disk.pdf");
  });

  it("reports a missing file the way the ordinary reader does", async () => {
    prepareView.mockRejectedValue(new Error("FILE_NOT_FOUND"));
    openViewSource.mockRejectedValue(new Error("FILE_NOT_FOUND"));
    readDocumentBytes.mockRejectedValue(new Error("FILE_NOT_FOUND"));

    await expect(readViewableSource("gone.pdf")).rejects.toThrow("FILE_NOT_FOUND");
  });

  it("reads the original file in ranges without asking for a view copy", async () => {
    openViewSource.mockResolvedValue({ token: "t-4", length: 200_000_000 });

    const source = await readOriginalSource("compare-a.pdf");

    expect(source).toEqual({ kind: "range", url: "http://vivepdf-view.localhost/t-4", token: "t-4" });
    expect(prepareView).not.toHaveBeenCalled();
  });

  it("reads the original bytes when no view source can be made", async () => {
    openViewSource.mockResolvedValue(null);

    const source = await readOriginalSource("small.pdf");

    expect(source.kind === "buffer" && new TextDecoder().decode(source.buffer)).toBe("small.pdf");
  });
});

describe("openViewable", () => {
  const task = <T,>(value: T) => ({ toPromise: () => Promise.resolve(value) });
  const opened = { task: task(undefined) };
  const manager = () => {
    const open = new Set<string>();
    return {
      open,
      openDocumentUrl: vi.fn((file: { documentId: string }) => {
        open.add(file.documentId);
        return task(opened);
      }),
      openDocumentBuffer: vi.fn((file: { documentId: string }) => {
        open.add(file.documentId);
        return task(opened);
      }),
      isDocumentOpen: (id: string) => open.has(id),
      closeDocument: vi.fn((id: string) => {
        open.delete(id);
        return { wait: (done: () => void) => done() };
      }),
    };
  };

  beforeEach(() => {
    releaseViewSource.mockClear();
  });

  it("opens a range source by its url and releases its token when closed", async () => {
    const docManager = manager();

    await openViewable(docManager as never, { kind: "range", url: "http://vivepdf-view.localhost/t-9", token: "t-9" }, { name: "a.pdf", documentId: "src-1", autoActivate: false });
    closeViewable(docManager as never, "src-1");

    expect(docManager.openDocumentUrl).toHaveBeenCalledWith({ url: "http://vivepdf-view.localhost/t-9", mode: "range-request", name: "a.pdf", documentId: "src-1", autoActivate: false });
    expect(docManager.closeDocument).toHaveBeenCalledWith("src-1");
    expect(releaseViewSource).toHaveBeenCalledWith("t-9");
  });

  it("opens bytes as a buffer and has no token to release", async () => {
    const docManager = manager();
    const buffer = bytesOf("b.pdf");

    await openViewable(docManager as never, { kind: "buffer", buffer }, { name: "b.pdf", documentId: "cmp-1" });
    closeViewable(docManager as never, "cmp-1");

    expect(docManager.openDocumentBuffer).toHaveBeenCalledWith({ buffer, name: "b.pdf", documentId: "cmp-1" });
    expect(releaseViewSource).not.toHaveBeenCalled();
  });

  it("releases the token of a document that failed to open exactly once", async () => {
    const docManager = manager();
    docManager.openDocumentUrl.mockImplementation(() => ({ toPromise: () => Promise.reject(new Error("broken")) }) as never);

    await expect(openViewable(docManager as never, { kind: "range", url: "u", token: "t-10" }, { name: "c.pdf", documentId: "cmp-2" })).rejects.toThrow("broken");
    closeViewable(docManager as never, "cmp-2");
    releaseViewSourceOf("cmp-2");

    expect(docManager.closeDocument).not.toHaveBeenCalled();
    expect(releaseViewSource).toHaveBeenCalledTimes(1);
  });
});
