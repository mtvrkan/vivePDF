import { useEffect, useRef } from "preact/hooks";
import annotateCss from "../styles/annotate.css?inline";
import { shouldDeselectAfterClick } from "./clickDeselect";
import { drawKeyAction } from "./drawKeys";
import type { AnnotateSession } from "./useAnnotateSession";

const adopted = new WeakSet<ShadowRoot>();

function useAnnotateStyles(host: HTMLElement | null) {
  useEffect(() => {
    const root = host?.getRootNode();
    if (!(root instanceof ShadowRoot) || adopted.has(root)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(annotateCss);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    adopted.add(root);
  }, [host]);
}

function useDrawKeys(host: HTMLElement | null, session: AnnotateSession) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const root = host?.getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    const onKeyDown = (event: Event) => {
      const current = sessionRef.current;
      if (!current.open || !(event instanceof KeyboardEvent)) return;
      const target = event.composedPath()[0];
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      const action = drawKeyAction(event, typing);
      if (action === "undo" && current.canUndo) current.undo();
      else if (action === "redo" && current.canRedo) current.redo();
      else if (action === "remove" && current.selected > 0) current.deleteSelected();
      else if (action === "dropTool" && current.tool) current.setTool(null);
      else if (action === "eraser") current.setTool(current.tool === "eraser" ? null : "eraser");
      else return;
      event.preventDefault();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [host]);
}

const CLICK_MOVE_LIMIT_PX = 4;

function useClickDeselect(host: HTMLElement | null, session: AnnotateSession) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const root = host?.getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    let start: { x: number; y: number; selected: string[] } | null = null;
    const onPointerDown = (event: Event) => {
      start = event instanceof PointerEvent ? { x: event.clientX, y: event.clientY, selected: sessionRef.current.selectedIds() } : null;
    };
    const onClick = (event: Event) => {
      const origin = start;
      start = null;
      if (!origin || !(event instanceof MouseEvent) || sessionRef.current.tool !== null) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > CLICK_MOVE_LIMIT_PX) return;
      const target = event.composedPath()[0];
      if (!(target instanceof Element) || !target.closest(".vp-page") || target.closest("[data-annotation-layer]")) return;
      if (shouldDeselectAfterClick(origin.selected, sessionRef.current.selectedIds())) sessionRef.current.deselect();
    };
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("click", onClick, true);
    };
  }, [host]);
}

export function AnnotateHost({ session, host }: { session: AnnotateSession; host: HTMLElement | null }) {
  useAnnotateStyles(host);
  useDrawKeys(host, session);
  useClickDeselect(host, session);
  const locked = session.open && session.tool !== null;
  useEffect(() => {
    if (!host || !locked) return;
    host.setAttribute("data-drawing", "");
    return () => host.removeAttribute("data-drawing");
  }, [host, locked]);
  return null;
}
