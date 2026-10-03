import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";

const releaseDocuments = vi.fn<(params: { path?: string }) => Promise<{ released: number }>>(() => Promise.resolve({ released: 1 }));
const warn = vi.fn();

vi.mock("@/shared/rpc/documents", () => ({ releaseDocuments: (params: { path?: string }) => releaseDocuments(params) }));
vi.mock("@/shared/lib/logger", () => ({ warn: (...args: unknown[]) => warn(...args) }));

const { releaseClosedDocuments } = await import("./engineRelease");

let stop: () => void;

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  stop = releaseClosedDocuments();
});

afterEach(() => {
  stop();
  releaseDocuments.mockClear();
  warn.mockClear();
});

describe("releaseClosedDocuments", () => {
  it("tells the engine to drop a document once no tab shows it", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/docs/a.pdf", null);
    register("b", "C:/docs/b.pdf", null);

    remove("a");

    expect(releaseDocuments).toHaveBeenCalledTimes(1);
    expect(releaseDocuments).toHaveBeenCalledWith({ path: "C:/docs/a.pdf" });
  });

  it("empties the engine's caches when the last document closes", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/docs/a.pdf", null);

    remove("a");

    expect(releaseDocuments).toHaveBeenCalledWith({});
  });

  it("keeps a document whose file is still open in another tab", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/docs/a.pdf", null);
    register("copy", "C:/docs/a.pdf", null);

    remove("a");

    expect(releaseDocuments).not.toHaveBeenCalled();
  });

  it("logs a release the engine could not carry out instead of throwing", async () => {
    releaseDocuments.mockRejectedValueOnce(new Error("engine stopped"));
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/docs/a.pdf", null);

    remove("a");
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith("engine.release", "Error: engine stopped");
  });
});
