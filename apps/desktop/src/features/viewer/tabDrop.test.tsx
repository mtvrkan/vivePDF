import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { TabDropEvent } from "@/types";
import { createDragHover, dropLineAt, dropPoint, placeDroppedTabs, tabBefore, useTabDropListener } from "./tabDrop";
import { useTabGroupStore } from "./tabGroups";

let dropHandler: ((event: { payload: TabDropEvent }) => void) | null = null;
const stopListening = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (name: string, handler: (event: { payload: TabDropEvent }) => void) => {
      if (name === "tab-drop") dropHandler = handler;
      return Promise.resolve(stopListening);
    },
  }),
}));

function rect(left: number, width: number, top = 0, height = 36): DOMRect {
  return { left, width, top, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function strip(tabs: Array<{ id: string; left: number }>): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => rect(0, 600);
  for (const tab of tabs) {
    const child = document.createElement("div");
    child.setAttribute("role", "tab");
    child.dataset.tabId = tab.id;
    child.getBoundingClientRect = () => rect(tab.left, 100);
    element.appendChild(child);
  }
  return element;
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  for (const id of ["a", "b", "c", "x", "y"]) useDocumentStore.getState().register(id, `/tmp/${id}.pdf`, null);
  useDocumentStore.setState({ order: ["a", "b", "c", "x", "y"] });
  useTabGroupStore.setState({ groups: [], memberOf: {} });
});

describe("dropPoint", () => {
  it("scales the shell's window point to page pixels when the interface is zoomed", () => {
    expect(dropPoint({ x: 300, y: 20, width: 1200, height: 800 }, 1000, 666.6)).toEqual({ x: 250, y: expect.closeTo(16.67, 1) });
  });

  it("keeps the point when the shell reports no size", () => {
    expect(dropPoint({ x: 30, y: 10, width: 0, height: 0 }, 1000, 700)).toEqual({ x: 30, y: 10 });
  });
});

describe("tabBefore", () => {
  it("names the first tab whose middle lies right of the drop", () => {
    const tabs = strip([{ id: "a", left: 0 }, { id: "b", left: 100 }, { id: "c", left: 200 }]);

    expect(tabBefore(tabs, 160, 18)).toBe("c");
    expect(tabBefore(tabs, 120, 18)).toBe("b");
    expect(tabBefore(tabs, 10, 18)).toBe("a");
    expect(tabBefore(tabs, 290, 18)).toBeNull();
  });

  it("appends when the drop is far below the strip or there is no strip", () => {
    expect(tabBefore(strip([{ id: "a", left: 0 }]), 10, 300)).toBeNull();
    expect(tabBefore(null, 10, 10)).toBeNull();
  });
});

describe("placeDroppedTabs", () => {
  it("puts dropped tabs before the anchor in their own order", () => {
    placeDroppedTabs(["x", "y"], "b", null);

    expect(useDocumentStore.getState().order).toEqual(["a", "x", "y", "b", "c"]);
  });

  it("appends when there is no anchor and joins a group it lands inside", () => {
    const group = useTabGroupStore.getState().create(["b", "c"]);
    useDocumentStore.setState({ order: ["a", "b", "c", "x"] });

    placeDroppedTabs(["x"], "c", null);

    expect(useDocumentStore.getState().order).toEqual(["a", "b", "x", "c"]);
    expect(useTabGroupStore.getState().memberOf.x).toBe(group);
  });

  it("rebuilds a dropped group with its name and colour, ignoring an unknown colour", () => {
    placeDroppedTabs(["x", "y"], null, { name: "Contracts", color: "teal", collapsed: true });
    placeDroppedTabs(["a"], null, { name: "Odd", color: "plaid", collapsed: false });

    const [first, second] = useTabGroupStore.getState().groups;
    expect(first).toMatchObject({ name: "Contracts", color: "teal", collapsed: true });
    expect(useTabGroupStore.getState().memberOf.y).toBe(first.id);
    expect(second.name).toBe("Odd");
    expect(second.color).not.toBe("plaid");
  });
});

describe("useTabDropListener", () => {
  it("opens the dropped files and places them as one group at the end", async () => {
    const openPaths = vi.fn(async (paths: string[]) => {
      paths.forEach((path, index) => useDocumentStore.getState().register(`new-${index}`, path, null));
    });
    const { unmount } = renderHook(() => useTabDropListener(openPaths));

    dropHandler?.({ payload: { paths: ["/tmp/m.pdf", "/tmp/n.pdf"], x: 10, y: 400, width: 1000, height: 700, group: { name: "Moved", color: "blue", collapsed: false } } });

    await waitFor(() => expect(useDocumentStore.getState().order.slice(-2)).toEqual(["new-0", "new-1"]));
    expect(openPaths).toHaveBeenCalledWith(["/tmp/m.pdf", "/tmp/n.pdf"]);
    expect(useTabGroupStore.getState().groups[0]).toMatchObject({ name: "Moved", color: "blue" });
    unmount();
    await waitFor(() => expect(stopListening).toHaveBeenCalledOnce());
  });
});

describe("createDragHover", () => {
  it("reports the drag outside at most every interval and once when it comes back", () => {
    const send = vi.fn();
    let time = 0;
    const hover = createDragHover(send, () => time);

    hover.move(false);
    hover.move(true);
    time = 10;
    hover.move(true);
    time = 40;
    hover.move(true);
    hover.move(false);
    hover.move(false);

    expect(send.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("ends a drag outside with one leave and ignores an end inside", () => {
    const send = vi.fn();
    const hover = createDragHover(send, () => 0);

    hover.end();
    hover.move(true);
    hover.end();
    hover.end();

    expect(send.mock.calls).toEqual([[true], [false]]);
  });
});

describe("dropLineAt", () => {
  it("draws the line at the left edge of the tab it lands before, or after the last tab", () => {
    const tabs = strip([{ id: "a", left: 0 }, { id: "b", left: 100 }]);

    expect(dropLineAt(tabs, 120, 18)).toBe(100);
    expect(dropLineAt(tabs, 190, 18)).toBe(200);
  });

  it("draws nothing away from the strip", () => {
    expect(dropLineAt(strip([{ id: "a", left: 0 }]), 10, 300)).toBeNull();
    expect(dropLineAt(null, 10, 10)).toBeNull();
  });
});
