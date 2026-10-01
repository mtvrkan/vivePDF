import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { useEncryptForm } from "./useEncryptForm";

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/tools/security?tab=encrypt"]}>{children}</MemoryRouter>;
}

describe("useEncryptForm", () => {
  it("forgets every password when the secrets are reset", () => {
    const { result } = renderHook(() => useEncryptForm(), { wrapper });
    act(() => {
      result.current.setUserPassword("user-secret");
      result.current.setOwnerPassword("owner-secret");
      result.current.setConfirmPassword("user-secret");
      result.current.setHolderPassword("holder-secret");
      result.current.setDecryptPassword("open-secret");
    });
    expect(result.current.ownerPassword).toBe("owner-secret");
    act(() => result.current.resetSecrets());
    expect(result.current.userPassword).toBe("");
    expect(result.current.ownerPassword).toBe("");
    expect(result.current.confirmPassword).toBe("");
    expect(result.current.holderPassword).toBe("");
    expect(result.current.decryptPassword).toBe("");
  });

  it("keeps the chosen settings and files when the secrets are reset", () => {
    const { result } = renderHook(() => useEncryptForm(), { wrapper });
    act(() => {
      result.current.setAlgorithm("aes128");
      result.current.setRecipients(["bob.cer"]);
      result.current.setHolderPath("me.p12");
    });
    act(() => result.current.resetSecrets());
    expect(result.current.algorithm).toBe("aes128");
    expect(result.current.recipients).toEqual(["bob.cer"]);
    expect(result.current.holderPath).toBe("me.p12");
  });

  it("returns the same reset function across renders", () => {
    const { result, rerender } = renderHook(() => useEncryptForm(), { wrapper });
    const first = result.current.resetSecrets;
    rerender();
    expect(result.current.resetSecrets).toBe(first);
  });
});
