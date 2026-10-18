import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";

const { getCodeBlocks } = vi.hoisted(() => ({ getCodeBlocks: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({ getCodeBlocks }));

import { useCodeBlocksForPage } from "./useCodeBlocks";

const BLOCKS = { blocks: [{ id: "b1" }] } as never;

beforeEach(() => {
  vi.useFakeTimers();
  usePresentationStore.getState().resetDocumentScope();
  useDocumentStore.setState({ documents: { doc: { path: "/docs/a.pdf", password: null } } } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getCodeBlocks.mockReset();
});

describe("useCodeBlocksForPage", () => {
  it("stores the blocks found on the page being shown", async () => {
    getCodeBlocks.mockResolvedValue(BLOCKS);
    renderHook(() => useCodeBlocksForPage("doc", 0));

    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(usePresentationStore.getState().codeBlocksByPage[0]).toBe(BLOCKS);
  });

  it("drops blocks that arrive after the presentation moved to another document", async () => {
    let answer!: (value: unknown) => void;
    getCodeBlocks.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderHook(() => useCodeBlocksForPage("doc", 0));
    await act(async () => vi.advanceTimersByTimeAsync(300));

    act(() => usePresentationStore.getState().resetDocumentScope());
    await act(async () => answer(BLOCKS));

    expect(usePresentationStore.getState().codeBlocksByPage[0]).toBeUndefined();
  });

  it("asks nothing when the document is not open", async () => {
    renderHook(() => useCodeBlocksForPage("missing", 0));

    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(getCodeBlocks).not.toHaveBeenCalled();
  });
});
