import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentNode } from "@/types/studio";
import { CONTENT_DELAY_MS, useDocumentStore } from "./documentStore";
import { createDocument } from "./model";

const typed = (text: string): DocumentNode => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(() => {
  vi.useFakeTimers();
  useDocumentStore.getState().open(createDocument("Notes"));
});

afterEach(() => {
  useDocumentStore.getState().close();
  vi.useRealTimers();
});

describe("deferred document content", () => {
  it("reads the editor once after typing pauses instead of on every key", () => {
    const read = vi.fn(() => typed("abc"));
    const before = useDocumentStore.getState().revision;

    for (let key = 0; key < 5; key += 1) useDocumentStore.getState().deferContent(read);
    vi.advanceTimersByTime(CONTENT_DELAY_MS - 1);
    const waiting = useDocumentStore.getState().revision;
    vi.advanceTimersByTime(1);

    expect(waiting).toBe(before);
    expect(read).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().document?.content).toEqual(typed("abc"));
    expect(useDocumentStore.getState().dirty).toBe(true);
  });

  it("hands over the latest text at once when something needs it before the pause", () => {
    useDocumentStore.getState().deferContent(() => typed("draft"));

    expect(useDocumentStore.getState().currentContent()).toEqual(typed("draft"));
    useDocumentStore.getState().setName("Renamed");

    expect(useDocumentStore.getState().document).toMatchObject({ name: "Renamed", content: typed("draft") });
  });

  it("drops the text still waiting from the previous document when another one opens", () => {
    useDocumentStore.getState().deferContent(() => typed("old"));

    useDocumentStore.getState().open(createDocument("Fresh"));
    vi.advanceTimersByTime(CONTENT_DELAY_MS);

    expect(useDocumentStore.getState().document?.name).toBe("Fresh");
    expect(useDocumentStore.getState().document?.content).not.toEqual(typed("old"));
  });
});
