import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import type { StudioListKind, StudioTextAlign, StudioTextElement } from "@/types/studio";
import { digitKey, shortcutLetter } from "@/shared/lib/shortcutKeys";
import { updateElement } from "../model/edit";
import { listMarkers, paragraphAt } from "../model/typography";
import { TextContent } from "./ElementView";
import { useStudioFontsStore } from "./fonts";
import { fitTextBox } from "./measure";
import {
  applyRunStyle,
  blockParagraph,
  boldPatch,
  paragraphIndexes,
  restoreSelection,
  selectionOffsets,
  shiftLevel,
  styleSummary,
  textFromDom,
  toggleList,
  updateParagraphs,
  withElementStyle,
  type StylePatch,
} from "./richText";
import { textEditorBridge, textEditorEntry, type ParagraphChange } from "./textEditorBridge";
import { useTextPrefsStore } from "./textPrefs";
import { useStudioStore } from "./studioStore";
import { blockNodes, blocksSignature, editorCaseStyle, ensureMarkerRule, textBlocks, textBodyStyle } from "./textStyle";

const STYLE_KEYS: Record<string, "bold" | "italic" | "underline"> = { b: "bold", i: "italic", u: "underline" };
const ALIGN_KEYS: Record<string, StudioTextAlign> = { l: "left", e: "center", r: "right" };
const LIST_DIGITS: Record<number, StudioListKind> = { 7: "decimal", 8: "bullet" };
const MIN_RUN_SIZE = 1;
const MAX_RUN_SIZE = 1000;

function syncMarkers(body: HTMLElement) {
  const blocks = Array.from(body.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.list !== undefined);
  const markers = listMarkers(blocks.map((block) => blockParagraph(block)));
  blocks.forEach((block, index) => {
    const marker = markers[index];
    if (marker) block.setAttribute("data-vp-marker", marker);
    else block.removeAttribute("data-vp-marker");
  });
}

function editorBlocks(element: StudioTextElement, language: string) {
  return textBlocks(element, { language: element.language ?? language, editing: true });
}

function sizeStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key === ">" || event.code === "Period") return 1;
  if (event.key === "<" || event.code === "Comma") return -1;
  return null;
}

export function TextEditor({ element, language }: { element: StudioTextElement; language: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef(element);
  const rendered = useRef(element);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const faces = useStudioFontsStore((state) => state.faces);
  const spellCheck = useTextPrefsStore((state) => state.spellCheck);
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const setEditing = useStudioStore((state) => state.setEditing);
  const textLanguage = element.language ?? language;
  const appLanguage = useRef(language);
  latest.current = element;
  appLanguage.current = language;

  const sized = (next: StudioTextElement, target: HTMLDivElement): StudioTextElement => {
    if (next.autoSize === "shrink") return next;
    if (next.autoSize === "fixed") return { ...next, height: Math.max(next.height, Math.ceil(target.offsetHeight)) };
    return { ...next, ...(fitTextBox(next, language) ?? {}) };
  };

  const commit = (change?: (current: StudioTextElement) => StudioTextElement, target: HTMLDivElement | null = bodyRef.current) => {
    if (!target) return;
    const current = latest.current;
    let next: StudioTextElement = { ...current, ...textFromDom(target, current) };
    if (change) next = change(next);
    next = sized(next, target);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    applyToPage((page) => updateElement<StudioTextElement>(page, current.id, next), { merge: `text-${current.id}` });
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;

  const keepSelection = (range: { start: number; end: number }) => {
    requestAnimationFrame(() => {
      if (!bodyRef.current) return;
      bodyRef.current.focus();
      restoreSelection(bodyRef.current, range.start, range.end);
    });
  };

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    ensureMarkerRule();
    body.replaceChildren(...blockNodes(editorBlocks(latest.current, appLanguage.current), useStudioFontsStore.getState().faces, true));
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
    const length = textFromDom(body, latest.current).runs.reduce((total, run) => total + run.text.length, 0);
    restoreSelection(body, 0, length);
    selection.current = { start: 0, end: length };
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const blocks = editorBlocks(element, language);
    const signature = blocksSignature(blocks, faces);
    if (body.dataset.rendered === signature) return;
    const first = body.dataset.rendered === undefined;
    if (!first && rendered.current === element) {
      const typed = textFromDom(body, element);
      if (JSON.stringify(typed.runs) !== JSON.stringify(element.runs) || JSON.stringify(typed.paragraphs) !== JSON.stringify(element.paragraphs)) {
        commitRef.current();
        return;
      }
    }
    body.dataset.rendered = signature;
    rendered.current = element;
    if (first) return;
    const saved = document.activeElement === body ? selectionOffsets(body) : null;
    body.replaceChildren(...blockNodes(blocks, faces, true));
    if (saved) restoreSelection(body, saved.start, saved.end);
  }, [element, faces, language]);

  useEffect(() => {
    const mounted = bodyRef.current;
    const onSelection = () => {
      const body = bodyRef.current;
      if (!body) return;
      const offsets = selectionOffsets(body);
      if (offsets) selection.current = offsets;
    };
    document.addEventListener("selectionchange", onSelection);
    const currentText = () => {
      const body = bodyRef.current;
      return body ? { ...latest.current, ...textFromDom(body, latest.current) } : latest.current;
    };
    textEditorBridge.current = {
      commit: () => commitRef.current(),
      insert: (text) => {
        bodyRef.current?.focus();
        document.execCommand("insertText", false, text);
      },
      summary: () => {
        const range = selection.current;
        if (!bodyRef.current || !range || range.start === range.end) return null;
        return styleSummary(currentText(), range.start, range.end);
      },
      selectedParagraphs: () => {
        const range = selection.current ?? { start: 0, end: 0 };
        const current = currentText();
        return paragraphIndexes(current.runs, range.start, range.end).map((index) => paragraphAt(current.paragraphs, index));
      },
      selectedText: () => {
        const range = selection.current;
        if (!range || range.start === range.end) return "";
        return currentText()
          .runs.map((run) => run.text)
          .join("")
          .slice(Math.min(range.start, range.end), Math.max(range.start, range.end));
      },
      applyStyle: (patch) => {
        const range = selection.current;
        if (!bodyRef.current) return;
        if (!range || range.start === range.end) {
          commitRef.current((current) => withElementStyle(current, patch));
          return;
        }
        commitRef.current((current) => ({ ...current, runs: applyRunStyle(current, range.start, range.end, patch) }));
        keepSelection(range);
      },
      update: (change) => commitRef.current(change),
      applyParagraphs: (change: ParagraphChange) => {
        const range = selection.current ?? { start: 0, end: 0 };
        if (!bodyRef.current) return;
        commitRef.current((current) => {
          const indexes = paragraphIndexes(current.runs, range.start, range.end);
          const chosen = indexes.map((index) => paragraphAt(current.paragraphs, index));
          return { ...current, paragraphs: updateParagraphs(current, indexes, change(chosen)) };
        });
        keepSelection(range);
      },
    };
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      textEditorBridge.current = null;
      commitRef.current(undefined, mounted);
    };
  }, []);

  const toggleStyle = (key: "bold" | "italic" | "underline" | "strike") => {
    const bridge = textEditorBridge.current;
    const summary = bridge?.summary();
    const next = !(summary ? summary[key] : latest.current[key]);
    const patch: StylePatch = key === "bold" ? boldPatch(next) : { [key]: next };
    bridge?.applyStyle(patch);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const bridge = textEditorBridge.current;
    if (event.key === "Escape") {
      event.preventDefault();
      commit();
      setEditing(null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      document.execCommand("insertParagraph");
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (bridge?.selectedParagraphs().some((paragraph) => paragraph.list !== "none")) bridge.applyParagraphs(() => shiftLevel(event.shiftKey ? -1 : 1));
      return;
    }
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!mod) return;
    const letter = shortcutLetter(event);
    const style = letter ? STYLE_KEYS[letter] : undefined;
    if (!event.shiftKey && style) {
      event.preventDefault();
      toggleStyle(style);
      return;
    }
    if (!event.shiftKey) return;
    if (letter === "x") {
      event.preventDefault();
      toggleStyle("strike");
      return;
    }
    const align = letter ? ALIGN_KEYS[letter] : undefined;
    if (align) {
      event.preventDefault();
      commit((current) => ({ ...current, align }));
      return;
    }
    const digit = digitKey(event);
    const list = digit === null ? undefined : LIST_DIGITS[digit];
    if (list) {
      event.preventDefault();
      bridge?.applyParagraphs((selected) => toggleList(selected, list));
      return;
    }
    const step = sizeStep(event);
    if (step && bridge) {
      event.preventDefault();
      const current = latest.current;
      const summary = bridge.summary();
      const size = Math.round((summary ? summary.scale : 1) * current.fontSize) + step;
      const clamped = Math.min(MAX_RUN_SIZE, Math.max(MIN_RUN_SIZE, size));
      if (summary) bridge.applyStyle({ scale: clamped / current.fontSize });
      else commit((value) => ({ ...withElementStyle(value, { scale: 1 }), fontSize: clamped }));
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
          data-text-body=""
          contentEditable
          suppressContentEditableWarning
          spellCheck={spellCheck}
          lang={textLanguage}
          onKeyDown={onKeyDown}
          onInput={(event) => syncMarkers(event.currentTarget)}
          onPaste={onPaste}
          onBlur={() => commit()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ ...textBodyStyle(element, element.fontSize), ...editorCaseStyle(element), cursor: "text", userSelect: "text" }}
        />
      }
    />
  );
}
