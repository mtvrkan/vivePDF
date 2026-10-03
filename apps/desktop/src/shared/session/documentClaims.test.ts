import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { claimDocument } from "@/shared/rpc/files";
import { openDocumentAt, shareOpenDocuments } from "./documentClaims";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

function sharedPaths(): string[][] {
  return invoke.mock.calls.filter(([command]) => command === "document_claims_sync").map(([, args]) => (args as { paths: string[] }).paths);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
});

describe("shareOpenDocuments", () => {
  it("tells the shell which files this window holds whenever the set changes", () => {
    const stop = shareOpenDocuments();
    const store = useDocumentStore.getState();
    store.register("1", "C:/docs/b.pdf", null);
    store.register("2", "C:/docs/a.pdf", null);
    store.setActive("1");
    store.remove("1");
    stop();
    store.register("3", "C:/docs/c.pdf", null);
    expect(sharedPaths()).toEqual([[], ["C:/docs/b.pdf"], ["C:/docs/a.pdf", "C:/docs/b.pdf"], ["C:/docs/a.pdf"]]);
  });

  it("does not fail when the shell refuses", async () => {
    invoke.mockRejectedValue(new Error("gone"));
    const stop = shareOpenDocuments();
    useDocumentStore.getState().register("1", "C:/docs/a.pdf", null);
    stop();
    await Promise.resolve();
    expect(sharedPaths()).toHaveLength(2);
  });
});

describe("claimDocument", () => {
  it("returns the window that already holds the file", async () => {
    invoke.mockResolvedValueOnce("doc-1");
    await expect(claimDocument("C:/docs/a.pdf")).resolves.toBe("doc-1");
    expect(invoke).toHaveBeenCalledWith("document_claim", { path: "C:/docs/a.pdf" });
  });

  it("lets the file open when the shell has no answer", async () => {
    invoke.mockResolvedValueOnce(null);
    await expect(claimDocument("C:/docs/a.pdf")).resolves.toBeNull();
    invoke.mockRejectedValueOnce(new Error("gone"));
    await expect(claimDocument("C:/docs/a.pdf")).resolves.toBeNull();
  });
});

describe("openDocumentAt", () => {
  it("finds an open document under another spelling of its path", () => {
    useDocumentStore.getState().register("1", "C:\\Docs\\A.pdf", null);
    expect(openDocumentAt("c:/docs/a.pdf")?.id).toBe("1");
    expect(openDocumentAt("c:/docs/b.pdf")).toBeNull();
  });
});
