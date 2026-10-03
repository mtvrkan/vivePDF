import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabGroupStore } from "@/features/viewer/tabGroups";
import { useDocumentStore } from "@/shared/store/documentStore";

vi.mock("@/features/viewer/useOpenPdf", () => ({ useOpenPdf: () => ({ openPaths: vi.fn() }) }));

const { collectionDocumentIds, groupCollectionTabs } = await import("./useOpenCollection");

const collection = { id: "c", name: "Contracts", color: "purple" as const, paths: ["C:/Docs/a.pdf", "C:/Docs/b.pdf"] };

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useTabGroupStore.setState({ groups: [], memberOf: {} });
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
