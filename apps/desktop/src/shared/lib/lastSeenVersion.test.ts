import { beforeEach, describe, expect, it } from "vitest";
import { compareVersions, readLastSeenVersion, takeUpdateAnnouncement } from "./lastSeenVersion";

const store = new Map<string, string>();

describe("lastSeenVersion", () => {
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) },
    });
  });

  it("compares versions by number, not by text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("v0.2.0", "0.2")).toBe(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.1")).toBe(-1);
  });

  it("announces an upgrade once and stays quiet on the next start", () => {
    store.set("vivepdf.lastSeenVersion", "0.2.0");

    expect(takeUpdateAnnouncement("0.3.0")).toBe(true);
    expect(takeUpdateAnnouncement("0.3.0")).toBe(false);
    expect(readLastSeenVersion()).toBe("0.3.0");
  });

  it("only records the version on a first install and after a downgrade", () => {
    expect(takeUpdateAnnouncement("0.3.0")).toBe(false);
    expect(readLastSeenVersion()).toBe("0.3.0");

    expect(takeUpdateAnnouncement("0.2.0")).toBe(false);
    expect(readLastSeenVersion()).toBe("0.2.0");
  });

  it("does not announce when storage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(takeUpdateAnnouncement("0.3.0")).toBe(false);
  });
});
