import { beforeEach, describe, expect, it } from "vitest";
import { useDropTargetStore } from "./dropTargetStore";

const position = { x: 10, y: 20 };

describe("dropTargetStore position handlers", () => {
  beforeEach(() => {
    useDropTargetStore.setState({ positionHandlers: [] });
  });

  it("lets the page under the cursor claim the drop even when another page registered later", () => {
    const seen: string[] = [];
    const firstPage = (paths: string[]) => {
      seen.push(`first:${paths[0]}`);
      return true;
    };
    const lastPage = () => {
      seen.push("last");
      return false;
    };
    const store = useDropTargetStore.getState();
    store.addPositionHandler(firstPage);
    store.addPositionHandler(lastPage);
    expect(useDropTargetStore.getState().claimPositionDrop(["a.png"], position)).toBe(true);
    expect(seen).toContain("first:a.png");
  });

  it("reports an unclaimed drop so the generic handler can run", () => {
    useDropTargetStore.getState().addPositionHandler(() => false);
    expect(useDropTargetStore.getState().claimPositionDrop(["a.png"], position)).toBe(false);
  });

  it("removes only the handler of the page that unmounted", () => {
    const kept = () => true;
    const removed = () => false;
    const store = useDropTargetStore.getState();
    store.addPositionHandler(kept);
    store.addPositionHandler(removed);
    store.removePositionHandler(removed);
    expect(useDropTargetStore.getState().positionHandlers).toEqual([kept]);
  });
});

describe("dropTargetStore layered handlers", () => {
  beforeEach(() => {
    useDropTargetStore.getState().setHandler(null);
  });

  it("hands drops back to the page's own handler when a tab's handler goes away", () => {
    const page = () => undefined;
    const tab = () => undefined;
    const store = useDropTargetStore.getState();

    store.pushHandler(page);
    store.pushHandler(tab);
    store.removeHandler(tab);

    expect(useDropTargetStore.getState().handler).toBe(page);
  });

  it("leaves no handler of an unmounted page behind whatever order its cleanups run in", () => {
    const page = () => undefined;
    const tab = () => undefined;
    const store = useDropTargetStore.getState();
    store.pushHandler(page);
    store.pushHandler(tab);

    store.removeHandler(page);
    store.removeHandler(tab);

    expect(useDropTargetStore.getState().handler).toBeNull();
    expect(useDropTargetStore.getState().layered).toEqual([]);
  });

  it("keeps a handler set directly by another page when a layered one is removed", () => {
    const layered = () => undefined;
    const direct = () => undefined;
    const store = useDropTargetStore.getState();
    store.pushHandler(layered);
    store.setHandler(direct);

    store.removeHandler(layered);

    expect(useDropTargetStore.getState().handler).toBe(direct);
  });
});
