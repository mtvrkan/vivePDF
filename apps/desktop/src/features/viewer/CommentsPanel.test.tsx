import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { listComments } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import type { CommentItem } from "@/types";

vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ provides: null }) }));
vi.mock("@/shared/rpc/operations", () => ({ listComments: vi.fn(), exportComments: vi.fn(), importComments: vi.fn() }));
vi.mock("./useDocumentSave", () => ({ useDocumentSave: () => ({ save: vi.fn() }) }));
vi.mock("./useOpenPdf", () => ({ useOpenPdf: () => ({ openPath: vi.fn() }) }));
vi.mock("./useUnsavedMarks", () => ({ useUnsavedMarks: () => false }));

const { CommentsPanel } = await import("./CommentsPanel");

const DOCUMENT_ID = "doc-comments";

function comment(xref: number, parent: number | null, content: string): CommentItem {
  return { xref, page: 1, type: "Text", author: "Ayşe", subject: "", content, created: "", modified: "", color: null, rect: [0, 0, 1, 1], resolved: false, quote: "", parent, state: null };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(listComments).mockReset();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/yorum.pdf", null);
  usePendingChangesStore.setState({ changes: {} });
});

afterEach(cleanup);

async function renderLoaded(items: CommentItem[]) {
  vi.mocked(listComments).mockResolvedValue({ items, authors: ["Ayşe"], types: ["Text"] } as never);
  render(<CommentsPanel documentId={DOCUMENT_ID} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("CommentsPanel", () => {
  it("disables reply and resolve on replies under a comment marked for deletion", async () => {
    await renderLoaded([comment(1, null, "kök"), comment(2, 1, "yanıt")]);
    usePendingChangesStore.getState().queue(DOCUMENT_ID, { kind: "commentDeleted", xrefs: [1], label: "kök" });
    const rows = await screen.findAllByRole("listitem");
    const replyRow = rows.find((row) => row.textContent?.includes("yanıt"));
    expect(replyRow?.className).toContain("line-through");
    const buttons = Array.from(replyRow?.querySelectorAll("button") ?? []);
    const reply = buttons.find((button) => button.getAttribute("aria-label") === "Reply");
    const resolve = buttons.find((button) => button.getAttribute("aria-label") === "Mark resolved");
    expect((reply as HTMLButtonElement).disabled).toBe(true);
    expect((resolve as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers a retry when loading fails", async () => {
    vi.mocked(listComments).mockRejectedValueOnce(new Error("boom"));
    render(<CommentsPanel documentId={DOCUMENT_ID} />);
    await act(async () => {
      await Promise.resolve();
    });
    vi.mocked(listComments).mockResolvedValue({ items: [comment(1, null, "kök")], authors: ["Ayşe"], types: ["Text"] } as never);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    });
    expect(listComments).toHaveBeenCalledTimes(2);
  });

  it("says nothing matches when the filters hide every comment", async () => {
    await renderLoaded([comment(1, null, "kök")]);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Page" }), { target: { value: "9" } });
    });
    expect(screen.getByText("No comments match the filters.")).toBeTruthy();
  });
});
