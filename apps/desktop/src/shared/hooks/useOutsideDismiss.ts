import { useEffect, useRef, type RefObject } from "react";

export function useOutsideDismiss(open: boolean, areas: ReadonlyArray<RefObject<HTMLElement | null>>, onDismiss: () => void) {
  const latest = useRef({ areas, onDismiss });
  latest.current = { areas, onDismiss };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && latest.current.areas.some((area) => area.current?.contains(target))) return;
      latest.current.onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);
}
