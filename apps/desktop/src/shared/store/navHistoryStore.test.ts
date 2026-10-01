import { beforeEach, describe, expect, it } from "vitest";
import { recordVisit, stepBack, stepForward, useNavHistoryStore } from "./navHistoryStore";

describe("page navigation history", () => {
  beforeEach(() => useNavHistoryStore.getState().clear("doc"));

  it("goes back to where a jump started and forward again", () => {
    const store = useNavHistoryStore.getState();
    store.record("doc", 1, 40);
    store.record("doc", 40, 12);
    expect(useNavHistoryStore.getState().back("doc", 12)).toBe(40);
    expect(useNavHistoryStore.getState().back("doc", 40)).toBe(1);
    expect(useNavHistoryStore.getState().back("doc", 1)).toBeNull();
    expect(useNavHistoryStore.getState().forward("doc", 1)).toBe(40);
    expect(useNavHistoryStore.getState().forward("doc", 40)).toBe(12);
  });

  it("drops the forward trail after a new jump and ignores jumps to the same page", () => {
    const afterBack = stepBack(recordVisit({ back: [], forward: [] }, 3, 9), 9);
    expect(afterBack?.stacks).toEqual({ back: [], forward: [9] });
    const stacks = recordVisit(afterBack?.stacks ?? { back: [], forward: [] }, 3, 5);
    expect(stacks).toEqual({ back: [3], forward: [] });
    expect(recordVisit(stacks, 5, 5)).toBe(stacks);
  });

  it("keeps history separate per document and caps its length", () => {
    let stacks = { back: [] as number[], forward: [] as number[] };
    for (let page = 1; page <= 80; page += 1) stacks = recordVisit(stacks, page, page + 1);
    expect(stacks.back).toHaveLength(50);
    expect(stacks.back[0]).toBe(31);
    expect(stepForward(stacks, 81)).toBeNull();
    useNavHistoryStore.getState().record("doc", 1, 2);
    expect(useNavHistoryStore.getState().back("other", 2)).toBeNull();
  });
});
