import { useEffect, type RefObject } from "react";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { hasOpenModal, isActivatableTarget, isInsideCompositeWidget } from "./viewerKeyTarget";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";

const MIDDLE_BUTTON = 1;
const TAP_MS = 250;
const PAGE_SCROLL_RATIO = 0.9;

let lastPointerHost: HTMLElement | null = null;

type Drag = { pointerId: number; x: number; y: number; left: number; top: number; moved: boolean };

export function useViewportPan(hostRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let spaceDownAt: number | null = null;
    let spaceShift = false;
    let dragged = false;
    let drag: Drag | null = null;

    const scroller = () => host.querySelector<HTMLElement>("[data-pan-scroller]");
    const setReady = (ready: boolean) => {
      if (ready) host.dataset.panReady = "";
      else delete host.dataset.panReady;
    };
    const ownsKeyboard = () => {
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused !== document.documentElement) {
        const owner = focused.closest<HTMLElement>("[data-pan-host]");
        if (owner) return owner === host;
      }
      return !lastPointerHost || !lastPointerHost.isConnected || lastPointerHost === host;
    };
    const spaceAllowed = () => !useViewerOverlayStore.getState().mode && !useUiStore.getState().immersive && !hasOpenModal() && ownsKeyboard();
    const markPointer = () => {
      lastPointerHost = host;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target) || isActivatableTarget(event.target) || isInsideCompositeWidget(event.target) || !spaceAllowed()) return;
      event.preventDefault();
      if (event.repeat) return;
      spaceDownAt = performance.now();
      spaceShift = event.shiftKey;
      dragged = false;
      setReady(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || spaceDownAt === null) return;
      const quickTap = performance.now() - spaceDownAt < TAP_MS && !dragged;
      spaceDownAt = null;
      setReady(false);
      const element = scroller();
      if (quickTap && element) element.scrollBy({ top: element.clientHeight * PAGE_SCROLL_RATIO * (spaceShift ? -1 : 1), behavior: "smooth" });
    };
    const onBlur = () => {
      spaceDownAt = null;
      setReady(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const middle = event.button === MIDDLE_BUTTON;
      const spacePan = event.button === 0 && spaceDownAt !== null;
      if (!middle && !spacePan) return;
      const element = scroller();
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false };
      host.setPointerCapture(event.pointerId);
      host.dataset.panning = "";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const element = scroller();
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      element.scrollLeft = drag.left - (event.clientX - drag.x);
      element.scrollTop = drag.top - (event.clientY - drag.y);
      drag.moved = true;
      dragged = true;
    };
    const endDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.stopPropagation();
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      drag = null;
      delete host.dataset.panning;
    };
    const swallowMiddle = (event: MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    host.dataset.panHost = "";
    host.addEventListener("pointerenter", markPointer);
    host.addEventListener("pointerdown", markPointer, true);
    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("pointermove", onPointerMove, true);
    host.addEventListener("pointerup", endDrag, true);
    host.addEventListener("pointercancel", endDrag, true);
    host.addEventListener("mousedown", swallowMiddle, true);
    host.addEventListener("auxclick", swallowMiddle, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      host.removeEventListener("pointerenter", markPointer);
      host.removeEventListener("pointerdown", markPointer, true);
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("pointermove", onPointerMove, true);
      host.removeEventListener("pointerup", endDrag, true);
      host.removeEventListener("pointercancel", endDrag, true);
      host.removeEventListener("mousedown", swallowMiddle, true);
      host.removeEventListener("auxclick", swallowMiddle, true);
      delete host.dataset.panning;
      delete host.dataset.panReady;
      delete host.dataset.panHost;
      if (lastPointerHost === host) lastPointerHost = null;
    };
  }, [hostRef]);
}
