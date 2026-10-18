import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentInfo, SourceDocument, TextSpan } from "@/types";

const { getTextSpans } = vi.hoisted(() => ({ getTextSpans: vi.fn() }));

vi.mock("@/shared/rpc/operations", () => ({ getTextSpans }));

import { useTextEditState } from "./useTextEditState";

const SPAN: TextSpan = { id: "s1", text: "Old", bbox: [10, 10, 40, 20], font: "Helvetica", fontXref: 0, size: 12, color: "#000000", bold: false, italic: false };
const t = ((key: string) => key) as unknown as TFunction;

function sourceOf(path: string): SourceDocument {
  return { path, fileName: path, password: null, info: { pageCount: 9 } as DocumentInfo };
}

afterEach(() => {
  cleanup();
  getTextSpans.mockReset();
});

describe("useTextEditState", () => {
  it("drops the edits and page of one document when another is picked", async () => {
    getTextSpans.mockResolvedValue({ width: 600, height: 800, spans: [SPAN] });
    const { result, rerender } = renderHook(({ source }) => useTextEditState(source, "textedit", t, vi.fn()), { initialProps: { source: sourceOf("a.pdf") } });
    await waitFor(() => expect(result.current.teditSpans).toHaveLength(1));
    act(() => result.current.goToTeditPage(5));
    act(() => result.current.applySpanEdit(SPAN, { text: "New" }));

    rerender({ source: sourceOf("b.pdf") });

    expect(result.current.teditEdits.size).toBe(0);
    expect(result.current.teditPage).toBe(1);
    await waitFor(() => expect(getTextSpans).toHaveBeenLastCalledWith(expect.objectContaining({ path: "b.pdf", page: 0 })));
  });

  it("keeps the edits when the same document comes back unlocked", async () => {
    getTextSpans.mockResolvedValue({ width: 600, height: 800, spans: [SPAN] });
    const { result, rerender } = renderHook(({ source }) => useTextEditState(source, "textedit", t, vi.fn()), { initialProps: { source: sourceOf("a.pdf") } });
    await waitFor(() => expect(result.current.teditSpans).toHaveLength(1));
    act(() => result.current.applySpanEdit(SPAN, { text: "New" }));

    rerender({ source: { ...sourceOf("a.pdf"), password: "secret" } });

    expect(result.current.teditEdits.size).toBe(1);
  });

  it("starts empty when there is no document", () => {
    const { result } = renderHook(() => useTextEditState(null, "textedit", t, vi.fn()));

    expect(result.current.teditEdits.size).toBe(0);
    expect(getTextSpans).not.toHaveBeenCalled();
  });
});
