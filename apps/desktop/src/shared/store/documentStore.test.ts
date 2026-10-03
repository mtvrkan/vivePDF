import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo: vi.fn() }));
vi.mock("@/shared/rpc/files", () => ({ fileNameOf: (path: string) => path.split("/").pop() ?? path }));

import { inTabOrder, movedTo, useDocumentStore } from "./documentStore";

function registry(open: string[]) {
  return { isDocumentOpen: vi.fn((id: string) => open.includes(id)), setActiveDocument: vi.fn() };
}

describe("documentStore.activate", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {}, order: [], activeId: null });
    useDocumentStore.getState().register("a", "/docs/a.pdf", null);
    useDocumentStore.getState().register("b", "/docs/b.pdf", null);
  });

  it("activates a document the viewer engine still has open", () => {
    const engine = registry(["a", "b"]);
    expect(useDocumentStore.getState().activate("b", engine)).toBe(true);
    expect(engine.setActiveDocument).toHaveBeenCalledWith("b");
    expect(useDocumentStore.getState().activeId).toBe("b");
  });

  it("never asks the engine to activate a document it already dropped and forgets the stale entry", () => {
    useDocumentStore.getState().setActive("a");
    const engine = registry(["a"]);
    expect(useDocumentStore.getState().activate("b", engine)).toBe(false);
    expect(engine.setActiveDocument).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents.b).toBeUndefined();
    expect(useDocumentStore.getState().activeId).toBe("a");
  });

  it("ignores ids the store does not know", () => {
    const engine = registry(["zzz"]);
    expect(useDocumentStore.getState().activate("zzz", engine)).toBe(false);
    expect(engine.setActiveDocument).not.toHaveBeenCalled();
  });

  it("still records the choice while the engine is starting", () => {
    expect(useDocumentStore.getState().activate("a", null)).toBe(true);
    expect(useDocumentStore.getState().activeId).toBe("a");
  });
});

describe("documentStore tab order", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {}, order: [], activeId: null });
    for (const id of ["a", "b", "c"]) useDocumentStore.getState().register(id, `/docs/${id}.pdf`, null);
  });

  it("keeps tabs in the order they were opened and moves one to a new place", () => {
    expect(useDocumentStore.getState().order).toEqual(["a", "b", "c"]);
    useDocumentStore.getState().move("c", 0);
    expect(useDocumentStore.getState().order).toEqual(["c", "a", "b"]);
  });

  it("does not add a document twice when it is registered again and drops it on close", () => {
    useDocumentStore.getState().register("b", "/docs/b.pdf", "secret");
    useDocumentStore.getState().remove("a");
    expect(useDocumentStore.getState().order).toEqual(["b", "c"]);
  });

  it("clamps moves past either end and ignores unknown documents", () => {
    expect(movedTo(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
    expect(movedTo(["a", "b", "c"], "c", -4)).toEqual(["c", "a", "b"]);
    expect(movedTo(["a", "b"], "z", 0)).toEqual(["a", "b"]);
    expect(inTabOrder([{ id: "b" }, { id: "x" }, { id: "a" }], ["a", "b"]).map((item) => item.id)).toEqual(["a", "b", "x"]);
  });
});
