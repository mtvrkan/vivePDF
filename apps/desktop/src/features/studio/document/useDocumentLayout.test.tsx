import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { DocumentNode } from "@/types/studio";

const rpc = vi.hoisted(() => ({ preview: vi.fn(), page: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ studioPreviewDocument: rpc.preview, studioPreviewDocumentPage: rpc.page }));

const { DocumentPreview } = await import("./DocumentPreview");
const { useDocumentLayout } = await import("./useDocumentLayout");
const { useDocumentStore } = await import("./documentStore");
const { createDocument } = await import("./model");

const BODY: DocumentNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };

function Preview() {
  return <DocumentPreview layout={useDocumentLayout("en")} />;
}

function typed(text: string): DocumentNode {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  vi.useFakeTimers();
  rpc.preview.mockReset();
  rpc.preview.mockResolvedValue({ token: "t", pageCount: 1, pages: [{ width: 595, height: 842 }] });
});

afterEach(() => {
  cleanup();
  useDocumentStore.getState().close();
  vi.useRealTimers();
});

describe("document layout", () => {
  it("lays the document out once after it opens", async () => {
    useDocumentStore.getState().open(createDocument("Notes", BODY));
    render(<Preview />);

    await act(async () => vi.advanceTimersByTime(800));

    expect(rpc.preview).toHaveBeenCalledTimes(1);
  });

  it("waits for a pause in typing and then lays the document out once", async () => {
    useDocumentStore.getState().open(createDocument("Notes", BODY));
    render(<Preview />);
    await act(async () => vi.advanceTimersByTime(800));

    for (const text of ["H", "He", "Hel", "Hell"]) {
      act(() => useDocumentStore.getState().setContent(typed(text)));
      await act(async () => vi.advanceTimersByTime(200));
    }
    expect(rpc.preview).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(800));

    expect(rpc.preview).toHaveBeenCalledTimes(2);
  });

  it("stops scheduling once it is closed", async () => {
    useDocumentStore.getState().open(createDocument("Notes", BODY));
    const { unmount } = render(<Preview />);
    unmount();

    act(() => useDocumentStore.getState().setContent(typed("later")));
    await act(async () => vi.advanceTimersByTime(2000));

    expect(rpc.preview).not.toHaveBeenCalled();
  });

  it("shows the page count once the layout arrives", async () => {
    rpc.preview.mockResolvedValue({ token: "t", pageCount: 3, width: 595, height: 842 });
    useDocumentStore.getState().open(createDocument("Notes", BODY));
    render(<Preview />);

    await act(async () => vi.advanceTimersByTime(800));

    expect(document.querySelector('[data-testid="document-preview-status"]')?.textContent).toBe("3 pages");
    expect(document.querySelectorAll("[data-preview-page]")).toHaveLength(3);
  });
});
