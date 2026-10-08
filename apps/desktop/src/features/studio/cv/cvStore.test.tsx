import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ fail: false, writes: 0 }));

vi.mock("./cvModel", async (original) => {
  const actual = await original<typeof import("./cvModel")>();
  return {
    ...actual,
    readStoredCv: () => null,
    writeStoredCv: () => {
      storage.writes += 1;
      return !storage.fail;
    },
  };
});

const { useCvStore } = await import("./cvStore");

const name = () => useCvStore.getState().profile.name;
const type = (value: string, merge = "field:name") => useCvStore.getState().updateProfile((profile) => ({ ...profile, name: value }), merge);

describe("cv builder history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage.fail = false;
    storage.writes = 0;
    useCvStore.setState({ loaded: false });
    useCvStore.getState().open("en");
  });

  afterEach(() => {
    useCvStore.getState().close();
    vi.useRealTimers();
  });

  it("merges a typing burst in one field into one undo step", () => {
    type("A");
    type("Al");
    type("Ale");

    useCvStore.getState().undo();

    expect(name()).toBe("");
    useCvStore.getState().redo();
    expect(name()).toBe("Ale");
  });

  it("starts a new step after a pause or in another field", () => {
    type("A");
    vi.advanceTimersByTime(1000);
    type("Al");
    useCvStore.getState().updateTheme({ accent: "#112233" }, "accent");

    useCvStore.getState().undo();
    expect(useCvStore.getState().theme.accent).toBeNull();
    useCvStore.getState().undo();
    expect(name()).toBe("A");
  });

  it("drops the redo steps after a new change and ignores changes that change nothing", () => {
    type("A");
    useCvStore.getState().undo();
    type("B", "other");
    const steps = useCvStore.getState().past.length;

    useCvStore.getState().updateProfile((profile) => profile);

    expect(useCvStore.getState().future).toEqual([]);
    expect(useCvStore.getState().past.length).toBe(steps);
  });

  it("saves after a short wait and remembers when saving failed", () => {
    storage.fail = true;
    type("A");

    vi.advanceTimersByTime(500);

    expect(storage.writes).toBe(1);
    expect(useCvStore.getState().saveFailed).toBe(true);
    storage.fail = false;
    type("B", "other");
    vi.advanceTimersByTime(500);
    expect(useCvStore.getState().saveFailed).toBe(false);
  });
});
