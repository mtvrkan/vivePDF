import { useLayoutEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { useViewerOverlayStore, type BlockRun, type RunStyle } from "@/shared/store/viewerOverlayStore";
import { caretRangeAt, placeCaretAtOffsets, selectionOffsets } from "./caret";
import { mergeRuns, rangeIsBold, rangeIsItalic, runStyleAttr, runsFromDom, setStyleRange, styleOf, textOf } from "./runs";
import type { RunStyler } from "./runRender";

type BlockEditorProps = {
  id: string;
  runs: BlockRun[];
  fallbackStyle: RunStyle;
  runStyle: RunStyler;
  height: number;
  scale: number;
  containerStyle: CSSProperties;
  background: string;
  caret: { x: number; y: number } | null;
  onFinish: () => void;
};

const GROW_EPSILON = 0.5;

function toCssText(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${String(value)}`)
    .join("; ");
}

function buildDom(container: HTMLElement, runs: BlockRun[], runStyle: RunStyler): void {
  container.replaceChildren();
  for (const run of runs) {
    const span = document.createElement("span");
    span.dataset.runStyle = runStyleAttr(styleOf(run));
    span.style.cssText = toCssText(runStyle(run));
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) span.appendChild(document.createElement("br"));
      if (part) span.appendChild(document.createTextNode(part));
    });
    container.appendChild(span);
  }
  if (container.childNodes.length === 0) container.appendChild(document.createElement("br"));
}

export function BlockEditor({ id, runs, fallbackStyle, runStyle, height, scale, containerStyle, background, caret, onFinish }: BlockEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const placedRef = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || placedRef.current) return;
    placedRef.current = true;
    buildDom(element, runs, runStyle);
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = caret ? caretRangeAt(element, caret.x, caret.y) : null;
    selection.removeAllRanges();
    if (range) {
      selection.addRange(range);
      return;
    }
    const end = document.createRange();
    end.selectNodeContents(element);
    end.collapse(false);
    selection.addRange(end);
  }, [runs, runStyle, caret]);

  const commit = () => {
    const element = ref.current;
    if (!element) return;
    const nextRuns = runsFromDom(element, fallbackStyle);
    const nextText = textOf(nextRuns);
    const needed = element.scrollHeight / scale;
    const patch: Record<string, unknown> = { text: nextText, runs: nextRuns };
    if (needed > height + GROW_EPSILON) patch.height = needed;
    useViewerOverlayStore.getState().updateObject(id, patch);
  };

  const toggleStyle = (key: "bold" | "italic") => {
    const element = ref.current;
    if (!element) return;
    const offsets = selectionOffsets(element);
    if (!offsets || offsets.start === offsets.end) return;
    const currentRuns = runsFromDom(element, fallbackStyle);
    const active = key === "bold" ? rangeIsBold(currentRuns, offsets.start, offsets.end) : rangeIsItalic(currentRuns, offsets.start, offsets.end);
    const nextRuns = mergeRuns(setStyleRange(currentRuns, offsets.start, offsets.end, { [key]: !active }));
    buildDom(element, nextRuns, runStyle);
    placeCaretAtOffsets(element, offsets.start, offsets.end);
    useViewerOverlayStore.getState().updateObject(id, { text: textOf(nextRuns), runs: nextRuns });
  };

  const insertPlainText = (text: string) => {
    if (document.execCommand("insertText", false, text)) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(window.document.createTextNode(text));
    range.collapse(false);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    insertPlainText(event.clipboardData.getData("text/plain"));
    commit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      commit();
      onFinish();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      insertPlainText("\n");
      commit();
      return;
    }
    const withModifier = event.ctrlKey || event.metaKey;
    if (!withModifier) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      toggleStyle("bold");
      return;
    }
    if (key === "i") {
      event.preventDefault();
      toggleStyle("italic");
      return;
    }
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      commit();
      useViewerOverlayStore.getState().setEditingObject(null);
      useViewerOverlayStore.getState().undo();
      return;
    }
    if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      commit();
      useViewerOverlayStore.getState().setEditingObject(null);
      useViewerOverlayStore.getState().redo();
    }
  };

  return (
    <div
      ref={ref}
      data-editor-input="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={commit}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      className="block h-full min-h-full w-full overflow-hidden p-0 outline-none"
      style={{ ...containerStyle, backgroundColor: background }}
    />
  );
}
