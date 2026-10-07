import { beforeEach, describe, expect, it } from "vitest";
import { fileChangeStatusOf, useFileChangeStore } from "./fileChangeStore";

beforeEach(() => useFileChangeStore.setState({ statuses: {} }));

describe("fileChangeStore", () => {
  it("finds a status by any spelling of the path", () => {
    useFileChangeStore.getState().mark(String.raw`C:\Docs\A.pdf`, "conflict");

    expect(fileChangeStatusOf("c:/docs/a.pdf")).toBe("conflict");
  });

  it("forgets statuses of documents that are no longer open", () => {
    useFileChangeStore.getState().mark("C:/a.pdf", "stale");
    useFileChangeStore.getState().mark("C:/b.pdf", "missing");

    useFileChangeStore.getState().keepOnly(["C:/b.pdf"]);

    expect(useFileChangeStore.getState().statuses).toEqual({ "c:/b.pdf": "missing" });
  });

  it("ignores clearing a path without a status", () => {
    const before = useFileChangeStore.getState().statuses;

    useFileChangeStore.getState().clear("C:/none.pdf");

    expect(useFileChangeStore.getState().statuses).toBe(before);
  });
});
