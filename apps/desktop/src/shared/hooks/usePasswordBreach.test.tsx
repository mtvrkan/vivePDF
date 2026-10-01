import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasswordBreachParams, PasswordBreachResult } from "@/types";

const calls: Array<{ params: PasswordBreachParams; signal?: AbortSignal }> = [];
let answer: (params: PasswordBreachParams) => Promise<PasswordBreachResult> = async () => ({ breached: false, count: null, source: "offline" });

vi.mock("@/shared/rpc/passwords", () => ({
  checkPasswordBreach: (params: PasswordBreachParams, options?: { signal?: AbortSignal }) => {
    calls.push({ params, signal: options?.signal });
    return answer(params);
  },
}));

import { BREACH_CHECK_DELAY_MS, usePasswordBreach } from "./usePasswordBreach";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

async function settle(ms = BREACH_CHECK_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  answer = async (params) => ({ breached: params.password === "password", count: null, source: "offline" });
  usePreferencesStore.getState().update({ breachCheckOnline: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePasswordBreach", () => {
  it("stays idle and never calls the engine for an empty password", async () => {
    const { result } = renderHook(() => usePasswordBreach(""));
    await settle();
    expect(result.current).toEqual({ checking: false, breached: false, variant: false, count: null, onlineUnavailable: false });
    expect(calls).toHaveLength(0);
  });

  it("waits for typing to pause and checks only the last value", async () => {
    const { result, rerender } = renderHook(({ value }) => usePasswordBreach(value), { initialProps: { value: "p" } });
    expect(result.current.checking).toBe(true);
    for (const value of ["pa", "pas", "pass", "password"]) {
      rerender({ value });
      await settle(BREACH_CHECK_DELAY_MS - 100);
    }
    expect(calls).toHaveLength(0);
    await settle(100);
    expect(calls.map((call) => call.params)).toEqual([{ password: "password", online: false }]);
    expect(result.current).toEqual({ checking: false, breached: true, variant: false, count: null, onlineUnavailable: false });
  });

  it("cancels a request that is still running when the password changes", async () => {
    let release: (value: PasswordBreachResult) => void = () => undefined;
    answer = () => new Promise((resolve) => (release = resolve));
    const { result, rerender } = renderHook(({ value }) => usePasswordBreach(value), { initialProps: { value: "password" } });
    await settle();
    expect(calls).toHaveLength(1);
    rerender({ value: "Kx9#vQ2!mZr7" });
    expect(calls[0].signal?.aborted).toBe(true);
    await act(async () => release({ breached: true, count: null, source: "offline" }));
    expect(result.current.breached).toBe(false);
    expect(result.current.checking).toBe(true);
  });

  it("passes the online preference and reports the count", async () => {
    usePreferencesStore.getState().update({ breachCheckOnline: true });
    answer = async () => ({ breached: true, count: 1234, source: "online" });
    const { result } = renderHook(() => usePasswordBreach("P@ssw0rd"));
    await settle();
    expect(calls[0].params).toEqual({ password: "P@ssw0rd", online: true });
    expect(result.current).toEqual({ checking: false, breached: true, variant: false, count: 1234, onlineUnavailable: false });
  });

  it("notes quietly when the online check fell back to the built-in list", async () => {
    usePreferencesStore.getState().update({ breachCheckOnline: true });
    const { result } = renderHook(() => usePasswordBreach("password"));
    await settle();
    expect(result.current).toEqual({ checking: false, breached: true, variant: false, count: null, onlineUnavailable: true });
  });

  it("never blocks on an engine error", async () => {
    answer = async () => {
      throw new Error("engine down");
    };
    const { result } = renderHook(() => usePasswordBreach("password"));
    await settle();
    expect(result.current).toEqual({ checking: false, breached: false, variant: false, count: null, onlineUnavailable: false });
  });

  it("marks a variant match from the engine", async () => {
    answer = async () => ({ breached: true, count: null, source: "offline", match: "variant" });
    const { result } = renderHook(() => usePasswordBreach("Password2026!"));
    await settle();
    expect(result.current).toEqual({ checking: false, breached: true, variant: true, count: null, onlineUnavailable: false });
  });

  it("does nothing while disabled", async () => {
    const { result } = renderHook(() => usePasswordBreach("password", false));
    await settle();
    expect(calls).toHaveLength(0);
    expect(result.current.checking).toBe(false);
  });
});
