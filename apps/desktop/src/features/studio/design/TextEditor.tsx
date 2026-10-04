import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import type { StudioTextElement } from "@/types/studio";
import { updateElement } from "../model/edit";
import { TextContent } from "./ElementView";
import { useStudioFontsStore } from "./fonts";
import { applyRunStyle, restoreSelection, runsFromDom, selectionOffsets, styleSummary, withElementStyle } from "./richText";
import { textEditorBridge, textEditorEntry } from "./textEditorBridge";
import { useStudioStore } from "./studioStore";
import { runsHtml, textBodyStyle } from "./textStyle";

const STYLE_KEYS: Record<string, "bold" | "italic" | "underline"> = { b: "bold", i: "italic", u: "underline" };

export function TextEditor({ element, language }: { element: StudioTextElement; language: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef(element);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const faces = useStudioFontsStore((state) => state.faces);
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const setEditing = useStudioStore((state) => state.setEditing);
  latest.current = element;

  const commit = (change?: (current: StudioTextElement) => StudioTextElement, target: HTMLDivElement | null = bodyRef.current) => {
    if (!target) return;
    const current = latest.current;
    let next: StudioTextElement = { ...current, runs: runsFromDom(target, current) };
    if (change) next = change(next);
    const height = current.shrinkToFit ? current.height : Math.max(current.height, Math.ceil(target.offsetHeight));
    next = { ...next, height };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    applyToPage((page) => updateElement<StudioTextElement>(page, current.id, next), { merge: `text-${current.id}` });
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.innerHTML = runsHtml(latest.current, useStudioFontsStore.getState().faces);
    body.focus();
    const point = textEditorEntry.point;
    textEditorEntry.point = null;
    const caret = point ? document.caretRangeFromPoint?.(point.x, point.y) : null;
    if (caret && body.contains(caret.startContainer)) {
      const range = window.getSelection();
      range?.removeAllRanges();
      range?.addRange(caret);
      selection.current = selectionOffsets(body);
      return;
    }
    const length = body.textContent?.length ?? 0;
    restoreSelection(body, 0, length);
    selection.current = { start: 0, end: length };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const html = runsHtml(element, faces);
    if (body.dataset.rendered === html) return;
    const first = body.dataset.rendered === undefined;
    body.dataset.rendered = html;
    if (first) return;
    const saved = document.activeElement === body ? selectionOffsets(body) : null;
    body.innerHTML = html;
    if (saved) restoreSelection(body, saved.start, saved.end);
  }, [element, faces]);

  useEffect(() => {
    const mounted = bodyRef.current;
    const onSelection = () => {
      const body = bodyRef.current;
      if (!body) return;
      const offsets = selectionOffsets(body);
      if (offsets) selection.current = offsets;
    };
    document.addEventListener("selectionchange", onSelection);
    textEditorBridge.current = {
      commit: () => commitRef.current(),
      insert: (text) => {
        bodyRef.current?.focus();
        document.execCommand("insertText", false, text);
      },
      summary: () => {
        const body = bodyRef.current;
        const range = selection.current;
        if (!body || !range || range.start === range.end) return null;
        return styleSummary({ ...latest.current, runs: runsFromDom(body, latest.current) }, range.start, range.end);
      },
      applyStyle: (patch) => {
        const body = bodyRef.current;
        const range = selection.current;
        if (!body) return;
        if (!range || range.start === range.end) {
          commitRef.current((current) => withElementStyle(current, patch));
          return;
        }
        commitRef.current((current) => ({ ...current, runs: applyRunStyle(current, range.start, range.end, patch) }));
        requestAnimationFrame(() => {
          if (!bodyRef.current) return;
          bodyRef.current.focus();
          restoreSelection(bodyRef.current, range.start, range.end);
        });
      },
    };
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      textEditorBridge.current = null;
      commitRef.current(undefined, mounted);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      commit();
      setEditing(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      return;
    }
    const key = event.key.toLowerCase();
    const style = STYLE_KEYS[key];
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && style) {
      event.preventDefault();
      const bridge = textEditorBridge.current;
      const summary = bridge?.summary();
      bridge?.applyStyle({ [style]: !(summary ? summary[style] : latest.current[style]) });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
  };

  return (
    <TextContent
      element={element}
      language={language}
      editable={
        <div
          ref={bodyRef}
          role="textbox"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ ...textBodyStyle(element, element.fontSize), cursor: "text", userSelect: "text" }}
        />
      }
    />
  );
}
