import { useEffect, useState } from "react";
import { checkPasswordBreach } from "@/shared/rpc/passwords";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

export const BREACH_CHECK_DELAY_MS = 400;

export type PasswordBreachState = {
  checking: boolean;
  breached: boolean;
  variant: boolean;
  count: number | null;
  onlineUnavailable: boolean;
};

const IDLE: PasswordBreachState = { checking: false, breached: false, variant: false, count: null, onlineUnavailable: false };
const CHECKING: PasswordBreachState = { ...IDLE, checking: true };

export function usePasswordBreach(password: string, enabled = true): PasswordBreachState {
  const online = usePreferencesStore((state) => state.breachCheckOnline);
  const active = enabled && password.length > 0;
  const [settled, setSettled] = useState<PasswordBreachState | null>(null);

  useEffect(() => {
    setSettled(null);
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkPasswordBreach({ password, online }, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setSettled({
            checking: false,
            breached: result.breached,
            variant: result.breached && result.match === "variant",
            count: result.count ?? null,
            onlineUnavailable: online && result.source === "offline",
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) setSettled(IDLE);
        });
    }, BREACH_CHECK_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, password, online]);

  if (!active) return IDLE;
  return settled ?? CHECKING;
}
