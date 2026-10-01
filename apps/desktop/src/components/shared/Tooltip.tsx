import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP_GAP, tooltipPosition, type TooltipPosition } from "./tooltipPosition";

const SHOW_DELAY_MS = 350;
const TIP_ATTRIBUTE = "data-tip";

type Anchor = { label: string; rect: DOMRect };

function readLabel(element: HTMLElement): string {
  const native = element.getAttribute("title");
  if (native !== null) {
    element.setAttribute(TIP_ATTRIBUTE, native);
    element.removeAttribute("title");
    return native;
  }
  return element.getAttribute(TIP_ATTRIBUTE) ?? "";
}

export function TooltipLayer() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let timer: number | null = null;
    let current: HTMLElement | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const hide = () => {
      clearTimer();
      current = null;
      setAnchor(null);
    };

    const schedule = (element: HTMLElement) => {
      if (element === current) return;
      clearTimer();
      current = element;
      setAnchor(null);
      const label = readLabel(element).trim();
      if (!label) return;
      timer = window.setTimeout(() => {
        if (current !== element || !element.isConnected || element.getAttribute("aria-expanded") === "true") return;
        setAnchor({ label, rect: element.getBoundingClientRect() });
      }, SHOW_DELAY_MS);
    };

    const findTarget = (node: EventTarget | null): HTMLElement | null => {
      if (!(node instanceof Element)) return null;
      return node.closest<HTMLElement>(`[title], [${TIP_ATTRIBUTE}]`);
    };

    const onOver = (event: MouseEvent) => {
      const target = findTarget(event.target);
      if (target) schedule(target);
      else if (current) hide();
    };

    const onOut = (event: MouseEvent) => {
      if (!current) return;
      const next = event.relatedTarget;
      if (next instanceof Node && current.contains(next)) return;
      hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = findTarget(event.target);
      if (target) schedule(target);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", hide);
    return () => {
      clearTimer();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("wheel", hide, { capture: true });
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor) {
      setPosition(null);
      return;
    }
    const bubble = bubbleRef.current;
    if (!bubble) return;
    setPosition(tooltipPosition(anchor.rect, bubble.offsetWidth, bubble.offsetHeight));
  }, [anchor]);

  if (!anchor) return null;
  return createPortal(
    <span
      ref={bubbleRef}
      role="tooltip"
      data-side={position?.side ?? "bottom"}
      className="tooltip-pop pointer-events-none fixed z-50 max-w-72 rounded-xl border border-(--glass-border) bg-card/95 px-3 py-2 text-xs leading-snug text-foreground shadow-(--shadow-float) backdrop-blur-md"
      style={{ top: position?.top ?? anchor.rect.bottom + TOOLTIP_GAP, left: position?.left ?? anchor.rect.left, visibility: position ? "visible" : "hidden" }}
    >
      {anchor.label}
    </span>,
    document.body,
  );
}
