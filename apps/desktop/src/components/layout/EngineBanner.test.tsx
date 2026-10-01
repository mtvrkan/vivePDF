import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEngineStore } from "@/shared/store/engineStore";
import { EngineBanner, SLOW_START_MS } from "./EngineBanner";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useEngineStore.setState({ status: "idle", info: null, error: null });
});

describe("EngineBanner", () => {
  it("says the engine is starting once the start takes longer than usual", () => {
    useEngineStore.setState({ status: "loading" });
    render(<EngineBanner />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => vi.advanceTimersByTime(SLOW_START_MS));

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("stays out of the way when the engine answers in time", () => {
    useEngineStore.setState({ status: "loading" });
    render(<EngineBanner />);

    act(() => useEngineStore.setState({ status: "success" }));
    act(() => vi.advanceTimersByTime(SLOW_START_MS));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still reports an engine that failed to start", () => {
    useEngineStore.setState({ status: "error", error: { code: "SIDECAR_DIED", message: "SIDECAR_DIED" } });

    render(<EngineBanner />);

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
