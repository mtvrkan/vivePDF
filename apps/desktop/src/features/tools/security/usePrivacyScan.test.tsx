import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentInfo, PrivacyReport, RpcError } from "@/types";

type InspectParams = { path: string; password?: string };

let answer: (params: InspectParams) => Promise<PrivacyReport> = async () => {
  throw new Error("not set");
};

vi.mock("@/shared/rpc/operations", () => ({
  inspectPrivacy: (params: InspectParams) => answer(params),
}));

import { usePrivacyScan } from "./usePrivacyScan";
import { describeError } from "@/shared/lib/errorMessage";

const info = { path: "a.pdf", fileName: "a.pdf", pageCount: 1 } as DocumentInfo;
const translate = (key: string, options?: Record<string, unknown>) => (key === "errors.INVALID_PDF" ? "translated invalid" : String(options?.defaultValue ?? key));

beforeEach(() => {
  answer = async () => {
    throw new Error("not set");
  };
});

afterEach(cleanup);

describe("usePrivacyScan", () => {
  it("keeps the error code so the page can show a translated message", async () => {
    const failure: RpcError = { code: "INVALID_PDF", message: "cannot open: a.pdf" };
    answer = async () => {
      throw failure;
    };
    const { result } = renderHook(() => usePrivacyScan({ tab: "privacy", sourcePath: "a.pdf", sourcePassword: undefined, info }));
    await waitFor(() => expect(result.current.scanError).not.toBeNull());
    expect(result.current.scanError?.code).toBe("INVALID_PDF");
    expect(describeError(translate, result.current.scanError as RpcError)).toBe("translated invalid");
    expect(result.current.report).toBeNull();
  });

  it("clears the error when a later scan succeeds", async () => {
    answer = async () => {
      throw { code: "INVALID_PDF", message: "x" } satisfies RpcError;
    };
    const { result } = renderHook(() => usePrivacyScan({ tab: "privacy", sourcePath: "a.pdf", sourcePassword: undefined, info }));
    await waitFor(() => expect(result.current.scanError).not.toBeNull());
    answer = async () => ({ pageCount: 1 }) as PrivacyReport;
    await act(async () => {
      await result.current.scan();
    });
    expect(result.current.scanError).toBeNull();
    expect(result.current.report?.pageCount).toBe(1);
  });

  it("does not scan outside the privacy tab", async () => {
    const calls = vi.fn(async () => ({ pageCount: 1 }) as PrivacyReport);
    answer = calls;
    renderHook(() => usePrivacyScan({ tab: "encrypt", sourcePath: "a.pdf", sourcePassword: undefined, info }));
    await act(async () => {});
    expect(calls).not.toHaveBeenCalled();
  });
});
