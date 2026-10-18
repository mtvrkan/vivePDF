import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/shared/store/uiStore";

const exitImmersive = vi.hoisted(() => vi.fn(async () => undefined));
const logged = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/features/viewer/immersive", () => ({ exitImmersive }));
vi.mock("@/shared/lib/logger", () => ({ error: logged, warn: vi.fn(), info: vi.fn(), describeError: String }));

const { ErrorBoundary } = await import("./ErrorBoundary");

function Broken(): never {
  throw new Error("canvas lost");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    exitImmersive.mockClear();
    logged.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    useUiStore.getState().setImmersive(true, 1);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useUiStore.getState().setImmersive(false);
  });

  it("logs a crash and leaves full screen so the fallback can be read", () => {
    render(
      <ErrorBoundary fallback={(error) => <p>{error.message}</p>}>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByText("canvas lost")).toBeTruthy();
    expect(logged).toHaveBeenCalledWith("react", expect.stringContaining("canvas lost"));
    expect(exitImmersive).toHaveBeenCalledTimes(1);
  });

  it("keeps a presentation running when its own fallback offers retry and exit", () => {
    render(
      <ErrorBoundary keepImmersive fallback={(error) => <p>{error.message}</p>}>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByText("canvas lost")).toBeTruthy();
    expect(logged).toHaveBeenCalledWith("react", expect.stringContaining("canvas lost"));
    expect(exitImmersive).not.toHaveBeenCalled();
  });

  it("does nothing to full screen outside a presentation", () => {
    useUiStore.getState().setImmersive(false);
    render(
      <ErrorBoundary fallback={(error) => <p>{error.message}</p>}>
        <Broken />
      </ErrorBoundary>,
    );

    expect(exitImmersive).not.toHaveBeenCalled();
  });
});
