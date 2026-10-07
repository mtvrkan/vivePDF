import { beforeEach, describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

const { useDocumentStore } = await import("@/shared/store/documentStore");
const { splitViewOf, useSplitViewStore } = await import("@/shared/store/splitViewStore");
const { compareWithAnotherDocument, openBeside, otherOpenDocuments } = await import("./splitTargets");

const MAIN = "C:/docs/main.pdf";
const OTHER = "C:/docs/other.pdf";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useSplitViewStore.setState({ views: {}, revisions: {}, lastLayout: "rows" });
  useDocumentStore.getState().register("a", MAIN, null);
});

describe("splitTargets", () => {
  it("compares with the first other open document", async () => {
    useDocumentStore.getState().register("b", OTHER, "pw");

    await compareWithAnotherDocument("a");

    expect(splitViewOf(useSplitViewStore.getState(), MAIN)).toMatchObject({ layout: "columns", secondary: { path: OTHER, password: "pw" } });
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it("asks for a file when no other document is open and stays closed on cancel", async () => {
    dialog.open.mockResolvedValueOnce(null).mockResolvedValueOnce("C:/docs/picked.pdf");

    await compareWithAnotherDocument("a");
    expect(useSplitViewStore.getState().views).toEqual({});
    await compareWithAnotherDocument("a");

    expect(splitViewOf(useSplitViewStore.getState(), MAIN)?.secondary).toEqual({ path: "C:/docs/picked.pdf", password: null });
  });

  it("opens a tab beside the active document with the last layout", () => {
    useDocumentStore.getState().register("b", OTHER, "pw");

    openBeside("a", "b");

    expect(splitViewOf(useSplitViewStore.getState(), MAIN)).toMatchObject({ layout: "rows", secondary: { path: OTHER, password: "pw" } });
  });

  it("lists other documents in tab order without the primary", () => {
    useDocumentStore.getState().register("b", OTHER, null);
    useDocumentStore.getState().register("c", "C:/docs/third.pdf", null);
    useDocumentStore.getState().move("c", 0);

    const others = otherOpenDocuments("a").map((entry) => entry.id);

    expect(others).toEqual(["c", "b"]);
  });
});
