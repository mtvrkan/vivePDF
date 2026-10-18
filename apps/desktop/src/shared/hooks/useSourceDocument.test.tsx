import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentInfo, SourceDocument } from "@/types";

const { getDocumentInfo } = vi.hoisted(() => ({ getDocumentInfo: vi.fn() }));

vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo }));

import { shouldPrefillSource, useSourceDocument } from "./useSourceDocument";

const open = { path: "C:/docs/open.pdf", fileName: "open.pdf", password: null, info: null };
const picked: SourceDocument = { path: "C:/docs/picked.pdf", fileName: "picked.pdf", password: null, info: null };

describe("shouldPrefillSource", () => {
  it("takes the open document when the page has none", () => {
    expect(shouldPrefillSource(false, null, open)).toBe(true);
  });

  it("leaves a file handed to the page alone, even before it has loaded", () => {
    expect(shouldPrefillSource(true, null, open)).toBe(false);
  });

  it("never replaces a source that is already there", () => {
    expect(shouldPrefillSource(false, picked, open)).toBe(false);
  });

  it("does nothing when no document is open", () => {
    expect(shouldPrefillSource(false, null, null)).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const INFO = { pageCount: 3 } as DocumentInfo;

afterEach(() => {
  cleanup();
  getDocumentInfo.mockReset();
});

describe("useSourceDocument", () => {
  it("keeps the file picked last when an earlier, slower load finishes after it", async () => {
    const slow = deferred<DocumentInfo>();
    getDocumentInfo.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(INFO);
    const { result } = renderHook(() => useSourceDocument(), { wrapper });

    act(() => void result.current.setPath("/docs/big.pdf"));
    await act(async () => result.current.setPath("/docs/small.pdf"));
    await act(async () => slow.resolve(INFO));

    expect(result.current.source?.path).toBe("/docs/small.pdf");
    expect(result.current.status).toBe("success");
  });

  it("ignores a password request from a file that was replaced", async () => {
    const slow = deferred<DocumentInfo>();
    getDocumentInfo.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce(INFO);
    const { result } = renderHook(() => useSourceDocument(), { wrapper });

    act(() => void result.current.setPath("/docs/locked.pdf"));
    await act(async () => result.current.setPath("/docs/open.pdf"));
    await act(async () => slow.reject({ code: "NEEDS_PASSWORD", message: "password" }));

    expect(result.current.needsPassword).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports the error of the file that is still current", async () => {
    getDocumentInfo.mockRejectedValueOnce({ code: "INVALID_PDF", message: "broken" });
    const { result } = renderHook(() => useSourceDocument(), { wrapper });

    await act(async () => result.current.setPath("/docs/broken.pdf"));

    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("INVALID_PDF");
  });
});
