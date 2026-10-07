import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfErrorCode } from "@embedpdf/models";

const sources = vi.hoisted(() => ({
  readOriginalSource: vi.fn(),
  openViewable: vi.fn(),
  closeViewable: vi.fn(),
  attachViewSource: vi.fn(),
}));
const manager = vi.hoisted(() => ({ getDocumentCount: vi.fn(() => 1) }));

vi.mock("@/shared/session/viewSources", () => sources);
vi.mock("@embedpdf/plugin-document-manager/react", () => ({ useDocumentManagerCapability: () => ({ provides: manager }) }));

const { useSplitDocument } = await import("./useSplitDocument");

const PATH = "C:/docs/split.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  manager.getDocumentCount.mockReturnValue(1);
  sources.readOriginalSource.mockResolvedValue({ kind: "buffer", buffer: new ArrayBuffer(4) });
  sources.openViewable.mockResolvedValue(undefined);
});

describe("useSplitDocument", () => {
  it("opens a hidden copy without activating it and closes it on unmount", async () => {
    const { result, unmount } = renderHook(() => useSplitDocument(PATH, "secret", 0, 0));
    await waitFor(() => expect(result.current.status).toBe("success"));

    const documentId = result.current.documentId;
    expect(sources.openViewable).toHaveBeenCalledWith(manager, expect.anything(), { name: "split.pdf", documentId, password: "secret", autoActivate: false });
    unmount();
    expect(sources.closeViewable).toHaveBeenCalledWith(manager, documentId);
  });

  it("reopens the file after a save", async () => {
    const { result, rerender } = renderHook(({ revision }) => useSplitDocument(PATH, null, revision, 0), { initialProps: { revision: 0 } });
    await waitFor(() => expect(result.current.status).toBe("success"));
    const first = result.current.documentId;

    rerender({ revision: 1 });
    await waitFor(() => expect(result.current).toEqual({ documentId: expect.not.stringMatching(first ?? ""), status: "success", error: null }));
    expect(sources.closeViewable).toHaveBeenCalledWith(manager, first);
    expect(sources.openViewable).toHaveBeenCalledTimes(2);
  });

  it("reports an open failure and releases the half-open copy", async () => {
    sources.openViewable.mockRejectedValue(new Error("broken"));
    const { result } = renderHook(() => useSplitDocument(PATH, null, 0, 0));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.documentId).toBeNull();
    expect(sources.closeViewable).toHaveBeenCalledTimes(1);
  });

  it("reports a locked file as NEEDS_PASSWORD so the pane can ask for it", async () => {
    sources.openViewable.mockRejectedValue({ reason: { code: PdfErrorCode.Password, message: "password required" } });

    const { result } = renderHook(() => useSplitDocument(PATH, null, 0, 0));

    await waitFor(() => expect(result.current.error?.code).toBe("NEEDS_PASSWORD"));
  });

  it("refuses to open when the document limit is reached", () => {
    manager.getDocumentCount.mockReturnValue(20);
    const { result } = renderHook(() => useSplitDocument(PATH, null, 0, 0));
    expect(result.current.status).toBe("error");
    expect(result.current.error?.data?.reason).toBe("tooManyDocuments");
    expect(sources.readOriginalSource).not.toHaveBeenCalled();
  });

  it("releases a range source that arrives after the pane closed", async () => {
    let resolveSource: (value: unknown) => void = () => undefined;
    sources.readOriginalSource.mockReturnValue(new Promise((resolve) => (resolveSource = resolve)));
    const { unmount } = renderHook(() => useSplitDocument(PATH, null, 0, 0));
    unmount();
    resolveSource({ kind: "range", url: "http://vivepdf-view.localhost/t", token: "t" });
    await waitFor(() => expect(sources.attachViewSource).toHaveBeenCalledWith(expect.any(String), "t"));
    expect(sources.openViewable).not.toHaveBeenCalled();
  });
});
