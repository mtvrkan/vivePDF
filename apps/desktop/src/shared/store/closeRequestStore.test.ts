import { beforeEach, describe, expect, it } from "vitest";
import { splitByUnsaved, useCloseRequestStore } from "./closeRequestStore";

describe("close requests", () => {
  beforeEach(() => useCloseRequestStore.getState().cancel());

  it("separates documents with unsaved work from clean ones", () => {
    expect(splitByUnsaved(["a", "b", "c"], (id) => id === "b")).toEqual({ clean: ["a", "c"], unsaved: ["b"] });
  });

  it("asks about each document once even when it is requested twice", () => {
    expect(splitByUnsaved(["a", "a"], () => true)).toEqual({ clean: [], unsaved: ["a"] });
    useCloseRequestStore.getState().enqueue(["a", "b"]);
    useCloseRequestStore.getState().enqueue(["b", "c"]);
    expect(useCloseRequestStore.getState().queue).toEqual(["a", "b", "c"]);
  });

  it("walks the queue and forgets it on cancel", () => {
    useCloseRequestStore.getState().enqueue(["a", "b"]);
    useCloseRequestStore.getState().advance();
    expect(useCloseRequestStore.getState().queue).toEqual(["b"]);
    useCloseRequestStore.getState().cancel();
    expect(useCloseRequestStore.getState().queue).toEqual([]);
  });
});
