import { describe, expect, it } from "vitest";
import { useSearchRequestStore } from "./searchRequestStore";

describe("search requests", () => {
  it("hands a request to each consumer once", () => {
    useSearchRequestStore.getState().requestSearch("entropy");
    expect(useSearchRequestStore.getState().take("viewer")).toBe("entropy");
    expect(useSearchRequestStore.getState().take("viewer")).toBeNull();
    expect(useSearchRequestStore.getState().take("library")).toBe("entropy");
  });

  it("does not replay an old request when a search bar opens later", () => {
    useSearchRequestStore.getState().requestSearch("stale");
    expect(useSearchRequestStore.getState().isPending("late", Date.now() + 60000)).toBe(false);
    expect(useSearchRequestStore.getState().take("late", Date.now() + 60000)).toBeNull();
  });

  it("gives the newest query after several requests", () => {
    useSearchRequestStore.getState().requestSearch("first");
    useSearchRequestStore.getState().requestSearch("second");
    expect(useSearchRequestStore.getState().take("viewer")).toBe("second");
  });
});
