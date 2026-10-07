import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import i18n, { ready, setLocale } from "@/app/i18n";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { pendingPageEdits } from "./pageEdits";

const DOCUMENT_ID = "thumbs";
const scrollToPage = vi.fn();
const scrollState = { currentPage: 1, totalPages: 2 };

vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ state: scrollState, provides: { scrollToPage } }) }));
vi.mock("@embedpdf/plugin-rotate/react", () => ({ useRotate: () => ({ provides: null }) }));
vi.mock("@embedpdf/plugin-thumbnail/react", () => ({
  ThumbnailsPane: ({ children }: { children: (meta: object) => ReactNode }) => (
    <div>{[0, 1].slice(0, scrollState.totalPages).map((pageIndex) => children({ pageIndex, top: pageIndex * 200, wrapperHeight: 200, width: 120, height: 160 }))}</div>
  ),
  ThumbImg: () => <img alt="" />,
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => ({ assemblePages: vi.fn() }));
vi.mock("@/shared/rpc/thumbnail", () => ({ renderThumbnail: vi.fn() }));
vi.mock("@/shared/store/pageLabelsStore", () => ({ usePageLabels: () => null }));

const { ThumbnailSidebar } = await import("./ThumbnailSidebar");

const edits = () => pendingPageEdits(pendingChangesFor(usePendingChangesStore.getState().changes, DOCUMENT_ID));
const deleteLabel = (page: number) => i18n.t("viewer.pageEdits.deletePage", { page });
const restoreLabel = (page: number) => i18n.t("viewer.pageEdits.restorePage", { page });
const rotateLabel = (page: number) => i18n.t("viewer.pageEdits.rotateRightPage", { page });
const thumbnails = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-keyshortcuts"));
const onPage = (page: number) => within(thumbnails()[page - 1].parentElement!);

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn();
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  scrollToPage.mockClear();
  scrollState.totalPages = 2;
  usePendingChangesStore.getState().clear(DOCUMENT_ID);
});

afterEach(cleanup);

describe("ThumbnailSidebar page edits", () => {
  it("marks a page for deletion from its quick button without scrolling to it", () => {
    render(<ThumbnailSidebar documentId={DOCUMENT_ID} />);

    fireEvent.click(onPage(2).getByRole("button", { name: deleteLabel(2) }));

    expect(edits()?.deleted).toEqual([1]);
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(screen.getByTestId("thumbnail-deleted-badge")).toBeTruthy();
    expect(onPage(2).getByRole("button", { name: restoreLabel(2) })).toBeTruthy();
  });

  it("restores a marked page and drops the pending change", () => {
    render(<ThumbnailSidebar documentId={DOCUMENT_ID} />);
    fireEvent.click(onPage(1).getByRole("button", { name: deleteLabel(1) }));

    fireEvent.click(onPage(1).getByRole("button", { name: restoreLabel(1) }));

    expect(edits()).toBeNull();
  });

  it("disables deleting the only page left", () => {
    scrollState.totalPages = 1;

    render(<ThumbnailSidebar documentId={DOCUMENT_ID} />);

    expect((onPage(1).getByRole("button", { name: deleteLabel(1) }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rotates from the quick button and from the keyboard", () => {
    render(<ThumbnailSidebar documentId={DOCUMENT_ID} />);

    fireEvent.click(onPage(1).getByRole("button", { name: rotateLabel(1) }));

    expect(edits()?.rotations).toEqual({ 0: 90 });
    expect(screen.getByTestId("thumbnail-rotation-badge").textContent).toBe("90°");
    expect(scrollToPage).not.toHaveBeenCalled();

    const thumbnail = thumbnails()[0];
    act(() => {
      fireEvent.keyDown(thumbnail, { key: "R", shiftKey: true });
    });

    expect(edits()).toBeNull();
  });

  it("toggles deletion with the Delete key on a focused thumbnail", () => {
    render(<ThumbnailSidebar documentId={DOCUMENT_ID} />);
    const thumbnail = thumbnails()[1];

    fireEvent.keyDown(thumbnail, { key: "Delete" });

    expect(edits()?.deleted).toEqual([1]);
  });
});
