import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";

const releaseViewSource = vi.fn<(token: string) => Promise<void>>(() => Promise.resolve());

vi.mock("@/shared/rpc/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/rpc/files")>()),
  releaseViewSource: (token: string) => releaseViewSource(token),
}));

const { attachViewSource, releaseClosedViewSources, releaseViewSourceOf } = await import("./viewSources");

let stop: () => void;

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  stop = releaseClosedViewSources();
});

afterEach(() => {
  stop();
  releaseViewSourceOf("a");
  releaseViewSourceOf("copy");
  releaseViewSource.mockClear();
});

describe("releaseClosedViewSources", () => {
  it("lets go of a large document's view copy once its tab closes", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/scans/book.pdf", null);
    attachViewSource("a", "t-a");
    register("b", "C:/docs/b.pdf", null);

    remove("b");
    expect(releaseViewSource).not.toHaveBeenCalled();
    remove("a");

    expect(releaseViewSource).toHaveBeenCalledTimes(1);
    expect(releaseViewSource).toHaveBeenCalledWith("t-a");
  });

  it("keeps a copy whose document is still opening under a new id", () => {
    const { register, remove } = useDocumentStore.getState();
    register("a", "C:/scans/locked.pdf", null);
    attachViewSource("copy", "t-copy");

    remove("a");
    expect(releaseViewSource).not.toHaveBeenCalled();
    register("copy", "C:/scans/locked.pdf", "secret");
    remove("copy");

    expect(releaseViewSource).toHaveBeenCalledWith("t-copy");
  });

  it("releases a copy whose document never opened, once", () => {
    attachViewSource("copy", "t-failed");

    releaseViewSourceOf("copy");
    releaseViewSourceOf("copy");

    expect(releaseViewSource).toHaveBeenCalledTimes(1);
    expect(releaseViewSource).toHaveBeenCalledWith("t-failed");
  });
});
