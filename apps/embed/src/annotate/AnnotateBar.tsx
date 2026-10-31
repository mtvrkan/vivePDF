import { useEffect, useRef, useState } from "preact/hooks";
import type { Lang } from "../i18n";
import annotateCss from "../styles/annotate.css?inline";
import { AnnotateIcon } from "./AnnotateIcon";
import { shouldDeselectAfterClick } from "./clickDeselect";
import { drawKeyAction } from "./drawKeys";
import { ANNOTATE_MESSAGES } from "./messages";
import { ANNOTATE_TOOLS, ANNOTATION_COLORS, STROKE_WIDTHS, hasStrokeWidth, worksOnText } from "./tools";
import type { AnnotateSession } from "./useAnnotateSession";

const adopted = new WeakSet<ShadowRoot>();

function useAnnotateStyles(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const root = ref.current?.getRootNode();
    if (!(root instanceof ShadowRoot) || adopted.has(root)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(annotateCss);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    adopted.add(root);
  }, [ref]);
}

function useDrawKeys(ref: { current: HTMLElement | null }, session: AnnotateSession) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const root = ref.current?.getRootNode();
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
  }, [ref]);
}

const CLICK_MOVE_LIMIT_PX = 4;

function useClickDeselect(ref: { current: HTMLElement | null }, session: AnnotateSession) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const root = ref.current?.getRootNode();
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
  }, [ref]);
}

export function AnnotateBar({ session, lang }: { session: AnnotateSession; lang: Lang }) {
  const text = ANNOTATE_MESSAGES[lang];
  const ref = useRef<HTMLDivElement>(null);
  useAnnotateStyles(ref);
  useDrawKeys(ref, session);
  useClickDeselect(ref, session);
  useEffect(() => {
    const frame = ref.current?.closest(".vp");
    if (!frame) return;
    if (session.open && session.tool !== null) frame.setAttribute("data-drawing", "");
    else frame.removeAttribute("data-drawing");
    return () => frame.removeAttribute("data-drawing");
  }, [session.open, session.tool]);
  const showWidth = session.tool !== null && hasStrokeWidth(session.tool);
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const removeAllRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) askRef.current?.focus();
  }, [asking]);
  const stopAsking = () => {
    setAsking(false);
    removeAllRef.current?.focus();
  };
  const hint = !session.open || session.tool === null ? null : session.tool === "eraser" ? text.eraserHint : worksOnText(session.tool) ? text.textHint : null;

  return (
    <>
      <div ref={ref} class="vp-draw vp-glass" role="toolbar" aria-label={text.bar} data-open={session.open ? "true" : "false"} hidden={!session.open}>
        <div class="vp-draw-group">
          {ANNOTATE_TOOLS.map((tool) => (
            <button key={tool} class="vp-btn" type="button" aria-label={text.tools[tool]} title={text.tools[tool]} aria-pressed={session.tool === tool} onClick={() => session.setTool(session.tool === tool ? null : tool)}>
              <AnnotateIcon name={tool} />
            </button>
          ))}
        </div>
        <span class="vp-sep" />
        <div class="vp-draw-group" role="radiogroup" aria-label={text.colors}>
          {ANNOTATION_COLORS.map((color, index) => (
            <button key={color} class="vp-swatch" type="button" role="radio" aria-checked={session.color === color} aria-label={text.colorNames[index]} title={text.colorNames[index]} style={{ "--vp-swatch": color }} onClick={() => session.setColor(color)} />
          ))}
        </div>
        {showWidth ? (
          <>
            <span class="vp-sep" />
            <div class="vp-draw-group" role="radiogroup" aria-label={text.width}>
              {STROKE_WIDTHS.map((width, index) => (
                <button key={width} class="vp-btn vp-width" type="button" role="radio" aria-checked={session.width === width} aria-label={text.widthNames[index]} title={text.widthNames[index]} onClick={() => session.setWidth(width)}>
                  <span class="vp-width-line" style={{ height: `${width}px` }} />
                </button>
              ))}
            </div>
          </>
        ) : null}
        <span class="vp-sep" />
        <div class="vp-draw-group">
          <button class="vp-btn" type="button" aria-label={text.undo} title={text.undo} disabled={!session.canUndo} onClick={session.undo}>
            <AnnotateIcon name="undo" />
          </button>
          <button class="vp-btn" type="button" aria-label={text.redo} title={text.redo} disabled={!session.canRedo} onClick={session.redo}>
            <AnnotateIcon name="redo" />
          </button>
          <button class="vp-btn" type="button" aria-label={text.remove} title={text.remove} disabled={session.selected === 0} onClick={session.deleteSelected}>
            <AnnotateIcon name="remove" />
          </button>
          <button ref={removeAllRef} class="vp-btn" type="button" aria-label={text.removeAll} title={text.removeAll} aria-haspopup="dialog" aria-expanded={asking} disabled={session.drawings === 0} onClick={() => setAsking(true)}>
            <AnnotateIcon name="removeAll" />
          </button>
          <button class="vp-btn" type="button" aria-label={text.close} title={text.close} onClick={() => session.setOpen(false)}>
            <AnnotateIcon name="close" />
          </button>
        </div>
      </div>
      {hint ? (
        <p class="vp-draw-hint" role="status">
          {hint}
        </p>
      ) : null}
      {asking && session.open ? (
        <div
          class="vp-confirm vp-glass"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="vp-confirm-question"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            stopAsking();
          }}
        >
          <p id="vp-confirm-question">{text.removeAllQuestion}</p>
          <div class="vp-confirm-actions">
            <button ref={askRef} class="vp-text-btn" type="button" onClick={stopAsking}>
              {text.cancel}
            </button>
            <button
              class="vp-text-btn vp-danger"
              type="button"
              onClick={() => {
                session.deleteAll();
                stopAsking();
              }}
            >
              {text.removeAllYes}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
