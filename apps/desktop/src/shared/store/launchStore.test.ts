import { beforeEach, describe, expect, it } from "vitest";
import { useLaunchStore } from "./launchStore";

const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");

describe("launchStore", () => {
  beforeEach(() => {
    useLaunchStore.setState({ pendingPath: null, pendingPaths: [], pendingRoute: null });
  });

  it("hands the file only to the tool it was sent to", () => {
    useLaunchStore.getState().setPending("C:/docs/a.pdf", "/tools/compress");
    expect(useLaunchStore.getState().consumeIf(isPdf, "/tools/ocr")).toBeNull();
    expect(useLaunchStore.getState().consumeIf(isPdf, "/tools/compress")).toBe("C:/docs/a.pdf");
  });

  it("ignores the query when matching the tool", () => {
    useLaunchStore.getState().setPending("C:/docs/a.pdf", "/tools/scan?tab=enhance");
    expect(useLaunchStore.getState().consumeIf(isPdf, "/tools/scan")).toBe("C:/docs/a.pdf");
  });

  it("gives a file out once", () => {
    useLaunchStore.getState().setPending("C:/docs/a.pdf", "/tools/ocr");
    useLaunchStore.getState().consumeIf(isPdf, "/tools/ocr");
    expect(useLaunchStore.getState().consumeIf(isPdf, "/tools/ocr")).toBeNull();
  });

  it("lets anyone take a file that names no tool", () => {
    useLaunchStore.getState().setPending("C:/docs/a.pdf");
    expect(useLaunchStore.getState().consumeIf(isPdf, "/tools/split")).toBe("C:/docs/a.pdf");
  });

  it("keeps a batch for its own tool as well", () => {
    useLaunchStore.getState().setPending("C:/docs/a.pdf", "/tools/merge");
    useLaunchStore.getState().setPendingPaths(["C:/docs/a.pdf", "C:/docs/b.pdf"]);
    expect(useLaunchStore.getState().consumeAll(isPdf, "/tools/batch")).toEqual([]);
    expect(useLaunchStore.getState().consumeAll(isPdf, "/tools/merge")).toEqual(["C:/docs/a.pdf", "C:/docs/b.pdf"]);
  });
});
