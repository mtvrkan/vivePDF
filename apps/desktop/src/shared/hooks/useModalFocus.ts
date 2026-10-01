import { useEffect, useRef, type RefObject } from "react";
import { focusableWithin, isTopmostModal, wrapTabFocus } from "@/shared/lib/focusTrap";

type ModalFocusOptions = {
  onEscape?: () => void;
  initialFocus?: "first" | "panel" | "none";
  trapTab?: boolean;
};

export function useModalFocus(panelRef: RefObject<HTMLElement | null>, open: boolean, { onEscape, initialFocus = "first", trapTab = true }: ModalFocusOptions = {}) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (panel && !panel.contains(document.activeElement)) {
      if (initialFocus === "first") {
        const target = focusableWithin(panel).find((element) => !element.hasAttribute("data-dialog-close"));
        (target ?? panel).focus({ preventScroll: true });
      } else if (initialFocus === "panel") {
        panel.focus({ preventScroll: true });
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const current = panelRef.current;
      if (!current || !isTopmostModal(current)) return;
      if (event.key === "Escape" && onEscapeRef.current) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (trapTab) wrapTabFocus(event, current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previous && previous.isConnected && previous !== document.body) {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected || panel?.contains(active)) previous.focus({ preventScroll: true });
      }
    };
  }, [open, panelRef, initialFocus, trapTab]);
}
