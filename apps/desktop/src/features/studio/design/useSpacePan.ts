import { useEffect, useRef, useState } from "react";
import { isControlTarget, isTextEntryTarget } from "@/shared/lib/typingTarget";

export function useSpacePan(cancelDrag: () => boolean) {
  const spaceHeld = useRef(false);
  const [panReady, setPanReady] = useState(false);
  const cancel = useRef(cancelDrag);
  cancel.current = cancelDrag;

  useEffect(() => {
    const release = () => {
      spaceHeld.current = false;
      setPanReady(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cancel.current()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.code !== "Space" || event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target) || isControlTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (!spaceHeld.current) {
        spaceHeld.current = true;
        setPanReady(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  return { spaceHeld, panReady };
}
