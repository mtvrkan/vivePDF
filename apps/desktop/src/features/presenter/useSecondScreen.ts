import { useEffect, useState } from "react";
import { countScreens } from "./presenterSession";

export const SCREEN_POLL_MS = 2000;

export function useSecondScreen(watching: boolean): boolean {
  const [found, setFound] = useState(false);
  useEffect(() => {
    setFound(false);
    if (!watching) return;
    let cancelled = false;
    const check = () =>
      void countScreens().then((screens) => {
        if (!cancelled) setFound(screens !== null && screens >= 2);
      });
    check();
    const timer = window.setInterval(check, SCREEN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [watching]);
  return found;
}
