import { useEffect, useRef, useState } from "preact/hooks";
import type { Lang } from "../i18n";
import { AnnotateIcon } from "./AnnotateIcon";
import { ANNOTATE_MESSAGES } from "./messages";
import { rovingTarget } from "./roving";
import { ANNOTATE_TOOLS, ANNOTATION_COLORS, STROKE_WIDTHS, hasStrokeWidth, worksOnText } from "./tools";
import type { AnnotateSession } from "./useAnnotateSession";

function arrowsIn(choose: (index: number) => void) {
  return (event: KeyboardEvent) => {
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")];
    const next = rovingTarget(event.key, items.indexOf(event.target as HTMLElement), items.length);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
    choose(next);
  };
}

export function AnnotateBar({ session, lang }: { session: AnnotateSession; lang: Lang }) {
  const text = ANNOTATE_MESSAGES[lang];
  const ref = useRef<HTMLDivElement>(null);
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
  const [toolStop, setToolStop] = useState(0);
  const close = () => {
    session.setOpen(false);
    ref.current?.closest(".vp")?.querySelector<HTMLElement>("[data-draw-toggle]")?.focus();
  };
  const hint = !session.open || session.tool === null ? null : session.tool === "eraser" ? text.eraserHint : worksOnText(session.tool) ? text.textHint : null;

  return (
    <>
      <div ref={ref} class="vp-draw vp-glass" role="toolbar" aria-label={text.bar} data-open={session.open ? "true" : "false"} hidden={!session.open}>
        <div class="vp-draw-group vp-draw-tools" onKeyDown={arrowsIn(setToolStop)}>
          {ANNOTATE_TOOLS.map((tool, index) => (
            <button
              key={tool}
              class="vp-btn"
              type="button"
              tabIndex={index === toolStop ? 0 : -1}
              aria-label={text.tools[tool]}
              title={text.tools[tool]}
              aria-pressed={session.tool === tool}
              onClick={() => {
                setToolStop(index);
                session.setTool(session.tool === tool ? null : tool);
              }}
            >
              <AnnotateIcon name={tool} />
            </button>
          ))}
        </div>
        <span class="vp-sep" />
        <div class="vp-draw-style">
          <div class="vp-draw-group vp-draw-colors" role="radiogroup" aria-label={text.colors} onKeyDown={arrowsIn((index) => session.setColor(ANNOTATION_COLORS[index] ?? session.color))}>
            {ANNOTATION_COLORS.map((color, index) => (
              <button key={color} class="vp-swatch" type="button" role="radio" tabIndex={session.color === color ? 0 : -1} aria-checked={session.color === color} aria-label={text.colorNames[index]} title={text.colorNames[index]} style={{ "--vp-swatch": color }} onClick={() => session.setColor(color)} />
            ))}
          </div>
          {showWidth ? (
            <>
              <span class="vp-sep" />
              <div class="vp-draw-group vp-draw-widths" role="radiogroup" aria-label={text.width} onKeyDown={arrowsIn((index) => session.setWidth(STROKE_WIDTHS[index] ?? session.width))}>
                {STROKE_WIDTHS.map((width, index) => (
                  <button key={width} class="vp-btn vp-width" type="button" role="radio" tabIndex={session.width === width ? 0 : -1} aria-checked={session.width === width} aria-label={text.widthNames[index]} title={text.widthNames[index]} onClick={() => session.setWidth(width)}>
                    <span class="vp-width-line" style={{ height: `${width}px` }} />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <span class="vp-sep" />
        <div class="vp-draw-group vp-draw-actions">
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
          <button class="vp-btn" type="button" aria-label={text.close} title={text.close} onClick={close}>
            <AnnotateIcon name="close" />
          </button>
        </div>
      </div>
      <p class="vp-draw-hint" role="status">
        {hint}
      </p>
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
