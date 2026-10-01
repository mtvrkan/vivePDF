import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo: vi.fn() }));
vi.mock("@/shared/rpc/files", () => ({ fileNameOf: (path: string) => path.split("/").pop() ?? path }));

import { useDocumentStore } from "./documentStore";

function registry(open: string[]) {
  return { isDocumentOpen: vi.fn((id: string) => open.includes(id)), setActiveDocument: vi.fn() };
}

describe("documentStore.activate", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {}, activeId: null });
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
