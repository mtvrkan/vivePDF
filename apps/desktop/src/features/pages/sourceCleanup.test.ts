import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo: vi.fn() }));
const releaseViewSource = vi.fn<(token: string) => Promise<void>>(() => Promise.resolve());
vi.mock("@/shared/rpc/files", () => ({ fileNameOf: (path: string) => path.split("/").pop() ?? path, releaseViewSource: (token: string) => releaseViewSource(token) }));

import type { OrganizerSource, OrganizerTile } from "@/types";
import { attachViewSource } from "@/shared/session/viewSources";
import { useDocumentStore } from "@/shared/store/documentStore";
import { MAIN_SOURCE_ID, pruneDroppedSources, useOrganizerStore } from "./organizerStore";
import { droppedIds, watchDocumentLifecycles } from "./sourceCleanup";
import { thumbnails } from "./thumbnailCache";

function source(id: string, embedDocId: string | null): OrganizerSource {
  return { id, path: `/docs/${id}.pdf`, password: null, fileName: `${id}.pdf`, embedDocId, pageCount: 2 };
}

function page(sourceId: string, index: number): OrganizerTile {
  return { key: `${sourceId}-${index}`, kind: "page", sourceId, index, rotate: 0 };
}

describe("pruneDroppedSources", () => {
  const sources = { [MAIN_SOURCE_ID]: source(MAIN_SOURCE_ID, "main-doc"), ext: source("ext", "src-1"), fresh: source("fresh", "src-2") };

  it("drops a source whose pages left the document and every history step", () => {
    const next = pruneDroppedSources(sources, [[page("ext", 1), page(MAIN_SOURCE_ID, 1)]], [[page(MAIN_SOURCE_ID, 1)]]);
    expect(Object.keys(next).sort()).toEqual(["fresh", MAIN_SOURCE_ID].sort());
  });

  it("keeps a source that undo can still bring back", () => {
    const next = pruneDroppedSources(sources, [[page("ext", 1)]], [[page(MAIN_SOURCE_ID, 1)], [page("ext", 1)]]);
    expect(next).toBe(sources);
  });

  it("keeps a freshly loaded source that has not been inserted yet", () => {
    expect(pruneDroppedSources(sources, [[page(MAIN_SOURCE_ID, 1)]], [[page(MAIN_SOURCE_ID, 2)]])).toBe(sources);
  });
});

describe("watchDocumentLifecycles", () => {
  const closed: string[] = [];
  const open = new Set(["src-1", "src-2"]);
  let stop: () => void = () => undefined;

  beforeEach(() => {
    closed.length = 0;
    releaseViewSource.mockClear();
    useOrganizerStore.getState().clear();
    useDocumentStore.setState({ documents: {}, activeId: null });
    stop = watchDocumentLifecycles(() => ({ isDocumentOpen: (id) => open.has(id), closeDocument: (id) => closed.push(id) }));
  });

  afterEach(() => stop());

  it("closes the hidden documents of inserted files when the organizer is cleared", () => {
    useOrganizerStore.getState().initialize({ ...source(MAIN_SOURCE_ID, "main-doc"), embedDocId: "main-doc" });
    useOrganizerStore.getState().addSource(source("ext", "src-1"));
    useOrganizerStore.getState().addSource(source("other", "src-2"));
    useOrganizerStore.getState().clear();
    expect(closed.sort()).toEqual(["src-1", "src-2"]);
  });

  it("releases the view source of an inserted file served in ranges when its hidden document closes", () => {
    useOrganizerStore.getState().initialize({ ...source(MAIN_SOURCE_ID, "main-doc"), embedDocId: "main-doc" });
    attachViewSource("main-doc", "t-main");
    attachViewSource("src-1", "t-src");
    useOrganizerStore.getState().addSource(source("ext", "src-1"));

    useOrganizerStore.getState().clear();

    expect(releaseViewSource.mock.calls).toEqual([["t-src"]]);
  });

  it("never closes the main document, which the viewer owns", () => {
    useOrganizerStore.getState().initialize({ ...source(MAIN_SOURCE_ID, "main-doc"), embedDocId: "main-doc" });
    useOrganizerStore.getState().clear();
    expect(closed).toEqual([]);
  });

  it("closes a source once no page and no history step uses it", () => {
    const store = useOrganizerStore.getState();
    store.initialize({ ...source(MAIN_SOURCE_ID, "main-doc"), embedDocId: "main-doc" });
    store.addSource(source("ext", "src-1"));
    store.commit([...useOrganizerStore.getState().tiles, page("ext", 1)]);
    expect(closed).toEqual([]);
    const withoutExt = useOrganizerStore.getState().tiles.filter((tile) => tile.kind !== "page" || tile.sourceId !== "ext");
    useOrganizerStore.getState().commit(withoutExt);
    expect(closed).toEqual([]);
    for (let step = 0; step < 100 && closed.length === 0; step += 1) useOrganizerStore.getState().commit([...withoutExt]);
    expect(closed).toEqual(["src-1"]);
    expect(useOrganizerStore.getState().sources.ext).toBeUndefined();
  });

  it("frees the thumbnails of a document that was closed in the viewer", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    useDocumentStore.getState().register("doc-x", "/docs/x.pdf", null);
    thumbnails.remember("doc-x:0:0.25", "blob:x0");
    thumbnails.remember("doc-y:0:0.25", "blob:y0");
    useDocumentStore.getState().remove("doc-x");
    expect(thumbnails.recall("doc-x:0:0.25")).toBeNull();
    expect(thumbnails.recall("doc-y:0:0.25")).toBe("blob:y0");
    expect(revoke).toHaveBeenCalledWith("blob:x0");
    revoke.mockRestore();
  });
});

describe("droppedIds", () => {
  it("lists ids that disappeared", () => {
    expect(droppedIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
});
