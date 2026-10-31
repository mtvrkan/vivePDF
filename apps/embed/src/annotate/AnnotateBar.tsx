import { useEffect, useRef } from "preact/hooks";
import type { Lang } from "../i18n";
import annotateCss from "../styles/annotate.css?inline";
import { AnnotateIcon } from "./AnnotateIcon";
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
      else return;
      event.preventDefault();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

export function AnnotateBar({ session, lang }: { session: AnnotateSession; lang: Lang }) {
  const text = ANNOTATE_MESSAGES[lang];
  const ref = useRef<HTMLDivElement>(null);
  useAnnotateStyles(ref);
  useDrawKeys(ref, session);
  const showWidth = session.tool !== null && hasStrokeWidth(session.tool);

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
          <button class="vp-btn" type="button" aria-label={text.close} title={text.close} onClick={() => session.setOpen(false)}>
            <AnnotateIcon name="close" />
          </button>
        </div>
      </div>
      {session.open && session.tool !== null && worksOnText(session.tool) ? (
        <p class="vp-draw-hint" role="status">
          {text.textHint}
        </p>
      ) : null}
    </>
  );
}
