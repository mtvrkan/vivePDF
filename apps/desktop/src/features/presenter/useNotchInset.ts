import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PRESENTER_EVENTS } from "./presenterChannel";

export function useNotchInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    let active = true;
    const measure = () => {
      void invoke<number>("presenter_inset")
        .then((value) => {
          if (active) setInset(Number.isFinite(value) && value > 0 ? value : 0);
        })
        .catch(() => undefined);
    };
    const stop = getCurrentWebviewWindow().listen(PRESENTER_EVENTS.placed, measure);
    measure();
    return () => {
      active = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  return inset;
}
