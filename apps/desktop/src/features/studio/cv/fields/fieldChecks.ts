import { useEffect, type RefObject } from "react";
import { claimFocus } from "../cvEdits";

export type ValueCheck = "email" | "url" | "phone";

const CHECKS: Record<ValueCheck, (value: string) => boolean> = {
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  url: (value) => /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+[\p{L}]{2,}(:\d+)?([/?#]\S*)?$/iu.test(value),
  phone: (value) => /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7,
};

export function looksValid(check: ValueCheck, value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || CHECKS[check](trimmed);
}

export function useClaimedFocus(id: string, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (claimFocus(id)) ref.current?.focus();
  }, [id, ref]);
}
