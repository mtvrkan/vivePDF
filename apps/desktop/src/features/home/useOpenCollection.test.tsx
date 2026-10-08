import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabGroupStore } from "@/features/viewer/tabGroups";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useOpenStore } from "@/shared/store/openStore";

const openPaths = vi.fn();
const invoke = vi.fn();
vi.mock("@/features/viewer/useOpenPdf", () => ({ useOpenPdf: () => ({ openPaths }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { collectionDocumentIds, groupCollectionTabs, useOpenCollection } = await import("./useOpenCollection");

const collection = { id: "c", name: "Contracts", color: "purple" as const, paths: ["C:/Docs/a.pdf", "C:/Docs/b.pdf"] };

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useTabGroupStore.setState({ groups: [], memberOf: {} });
  useOpenStore.setState({ passwordRequest: null, waitingPaths: [], afterWaiting: null });
  openPaths.mockReset();
  openPaths.mockResolvedValue(undefined);
  invoke.mockReset();
  invoke.mockImplementation((_command: string, args: { paths: string[] }) => Promise.resolve(args.paths.map(() => true)));
});

describe("groupCollectionTabs", () => {
  it("puts the collection's open documents into one named tab group next to each other", () => {
    for (const [id, path] of [["a", "C:/Docs/a.pdf"], ["x", "C:/Other/x.pdf"], ["b", "c:\\docs\\B.pdf"]]) useDocumentStore.getState().register(id, path, null);

    groupCollectionTabs(collection);

    const { groups, memberOf } = useTabGroupStore.getState();
    expect(groups).toMatchObject([{ name: "Contracts", color: "purple" }]);
    expect(memberOf).toEqual({ a: groups[0].id, b: groups[0].id });
    expect(useDocumentStore.getState().order).toEqual(["a", "b", "x"]);
  });

  it("leaves a single opened file ungrouped", () => {
    useDocumentStore.getState().register("a", "C:/Docs/a.pdf", null);

    groupCollectionTabs(collection);

    expect(collectionDocumentIds(collection)).toEqual(["a"]);
    expect(useTabGroupStore.getState().groups).toEqual([]);
  });
});

describe("useOpenCollection", () => {
  it("opens only the files that still exist", async () => {
    invoke.mockResolvedValue([false, true]);
    const { result } = renderHook(() => useOpenCollection());

    expect(await result.current(collection)).toBe(true);

    expect(openPaths).toHaveBeenCalledWith(["C:/Docs/b.pdf"]);
  });

  it("opens nothing when every file is gone", async () => {
    invoke.mockResolvedValue([false, false]);
    const { result } = renderHook(() => useOpenCollection());

    expect(await result.current(collection)).toBe(false);

    expect(openPaths).not.toHaveBeenCalled();
  });

  it("groups the files that open after a password into the same tab group", async () => {
    openPaths.mockImplementation(async () => {
      useDocumentStore.getState().register("a", "C:/Docs/a.pdf", null);
      useOpenStore.setState({ passwordRequest: { documentId: "a", fileName: "a.pdf", wrongPassword: false }, waitingPaths: ["C:/Docs/b.pdf"] });
    });
    const { result } = renderHook(() => useOpenCollection());

    await result.current(collection);
    expect(useTabGroupStore.getState().groups).toEqual([]);

    useDocumentStore.getState().register("b", "C:/Docs/b.pdf", null);
    useOpenStore.getState().afterWaiting?.();

    const { groups, memberOf } = useTabGroupStore.getState();
    expect(groups).toMatchObject([{ name: "Contracts" }]);
    expect(memberOf).toEqual({ a: groups[0].id, b: groups[0].id });
  });

  it("adds a late file to the collection's existing group instead of making a second one", () => {
    useDocumentStore.getState().register("a", "C:/Docs/a.pdf", null);
    useDocumentStore.getState().register("b", "C:/Docs/b.pdf", null);
    groupCollectionTabs(collection);
    const third = { ...collection, paths: [...collection.paths, "C:/Docs/c.pdf"] };
    useDocumentStore.getState().register("c", "C:/Docs/c.pdf", null);

    groupCollectionTabs(third);

    const { groups, memberOf } = useTabGroupStore.getState();
    expect(groups).toHaveLength(1);
    expect(memberOf.c).toBe(groups[0].id);
  });
});
