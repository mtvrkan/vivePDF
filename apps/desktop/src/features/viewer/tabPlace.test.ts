import { beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { neighbourAfterClose, restoreTabPlace, tabPlaceOf } from "./tabPlace";
import { useTabGroupStore } from "./tabGroups";

describe("neighbourAfterClose", () => {
  it("picks the tab to the right of the closed one", () => {
    expect(neighbourAfterClose(["a", "b", "c"], "b", ["a", "c"])).toBe("c");
  });

  it("falls back to the tab on the left when the last tab closes", () => {
    expect(neighbourAfterClose(["a", "b", "c"], "c", ["a", "b"])).toBe("b");
  });

  it("returns null when nothing else is open", () => {
    expect(neighbourAfterClose(["a"], "a", [])).toBeNull();
  });

  it("skips tabs that are no longer open", () => {
    expect(neighbourAfterClose(["a", "b", "c", "d"], "b", ["a", "d"])).toBe("d");
  });
});

describe("tab place", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {}, order: [], activeId: null });
    useTabGroupStore.setState({ groups: [], memberOf: {} });
  });

  it("puts a reopened document back at its old position and group", () => {
    const store = useDocumentStore.getState();
    store.register("a", "C:/a.pdf", null);
    store.register("b", "C:/b.pdf", null);
    store.register("c", "C:/c.pdf", null);
    const group = useTabGroupStore.getState().create(["b", "c"]);
    const place = tabPlaceOf("b");

    useDocumentStore.getState().remove("b");
    useDocumentStore.getState().register("b2", "C:/b.pdf", null);
    restoreTabPlace("b2", place);
    useTabGroupStore.getState().forget("b");

    expect(useDocumentStore.getState().order).toEqual(["a", "b2", "c"]);
    expect(useTabGroupStore.getState().memberOf.b2).toBe(group);
  });

  it("has no place for an unknown document", () => {
    expect(tabPlaceOf("missing")).toBeNull();
  });
});
