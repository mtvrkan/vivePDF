import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isBrowserShortcut } from "@/shared/lib/browserKeys";
import { bracketKey, digitKey, shortcutLetter, zoomKey } from "@/shared/lib/shortcutKeys";
import { describeError } from "@/shared/lib/errorMessage";
import { isControlTarget, isTextEntryTarget } from "@/shared/lib/typingTarget";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { StudioListKind, StudioShapeKind } from "@/types/studio";
import type { FlipAxis } from "../model/flip";
import { canvasBridge } from "./canvasBridge";
import { flipSelection, group, nudge, patchSelected, reorder, selectAll, toggleHiddenSelection, toggleLock, ungroup } from "./commands";
import { beginCrop, croppable, isCropping } from "./cropMode";
import { pasteImageFiles } from "./imageImport";
import { ARROW_PRESET, insertShape, insertText, TEXT_PRESETS, type ShapePreset } from "./insert";
import { claimSystemPaste, clipboardImages, expectSystemPaste } from "./systemPaste";
import { copyStyle, pasteStyle } from "./styleClipboard";
import { boldPatch, toggleList, updateParagraphs, withElementStyle } from "./richText";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";
import { textEditorBridge } from "./textEditorBridge";
import { fromMm } from "./units";
import { useViewPrefs, type StudioViewOption } from "./viewPrefs";
import { isGraphic } from "../graphics/graphicData";
import { openGraphic } from "../graphics/graphicEditor";

const NUDGE = fromMm(0.5);
const NUDGE_FAR = fromMm(5);
const ZOOM_STEP = 1.25;
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 1000;
const STYLE_KEYS: Record<string, "bold" | "italic" | "underline"> = { b: "bold", i: "italic", u: "underline" };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const TOOL_SHAPES: Record<string, StudioShapeKind | ShapePreset> = { r: "rect", o: "ellipse", l: "line", a: ARROW_PRESET };
const CONTROL_KEYS = new Set(["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const BODY_PRESET = TEXT_PRESETS[TEXT_PRESETS.length - 1];
const VIEW_KEYS: Record<string, StudioViewOption> = { r: "rulers", g: "guides", m: "margins" };
const FLIP_KEYS: Record<string, FlipAxis> = { h: "horizontal", v: "vertical" };
const LIST_DIGITS: Record<number, StudioListKind> = { 7: "decimal", 8: "bullet" };

function styleKey(event: KeyboardEvent): "copy" | "paste" | null {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return null;
  if (event.code === "KeyC") return "copy";
  if (event.code === "KeyV") return "paste";
  return null;
}

export type StudioShortcutActions = { onOpen?: () => void; onHelp?: () => void; onPrint?: () => void; onFind?: (replace: boolean) => void };

function fontSizeStep(event: KeyboardEvent): 1 | -1 | null {
  if (!event.shiftKey) return null;
  if (event.key === ">" || event.code === "Period") return 1;
  if (event.key === "<" || event.code === "Comma") return -1;
  return null;
}

function stepPage(direction: 1 | -1) {
  const state = useStudioStore.getState();
  const pages = state.design?.pages ?? [];
  const index = pages.findIndex((page) => page.id === state.pageId);
  const next = pages[index + direction];
  if (next) state.setPage(next.id);
}

export function useStudioShortcuts(onExport: () => void, onSave: (saveAs: boolean) => void, actions: StudioShortcutActions = {}) {
  const { t } = useTranslation();
  const latest = useRef({ onExport, onSave, actions, t });
  latest.current = { onExport, onSave, actions, t };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.defaultPrevented && !isBrowserShortcut(event)) || document.querySelector('[role="dialog"]')) return;
      const state = useStudioStore.getState();
      if (!state.design) return;
      const handlers = latest.current;
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const letter = shortcutLetter(event);
      const run = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };
      const commitText = () => textEditorBridge.current?.commit();
      if (mod && letter === "s") return run(() => {
        commitText();
        handlers.onSave(event.shiftKey);
      });
      if (mod && letter === "e" && !event.shiftKey) return run(() => {
        commitText();
        handlers.onExport();
      });
      if (mod && letter === "o" && !event.shiftKey && handlers.actions.onOpen) return run(handlers.actions.onOpen);
      const onPrint = handlers.actions.onPrint;
      if (mod && letter === "p" && !event.shiftKey && onPrint) return run(() => {
        commitText();
        onPrint();
      });
      const find = handlers.actions.onFind;
      if (mod && !event.shiftKey && (letter === "f" || letter === "h") && find) return run(() => find(letter === "h"));
      if (isTextEntryTarget(event.target) || isCropping()) return;
      const style = styleKey(event);
      if (style && state.selection.length) return run(style === "copy" ? copyStyle : pasteStyle);
      if (!mod && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "?" || event.key === "F1") && handlers.actions.onHelp) return run(handlers.actions.onHelp);
      if (mod) {
        if (letter === "z" && !event.shiftKey) return run(state.undo);
        if (letter === "y" || (letter === "z" && event.shiftKey)) return run(state.redo);
        if (letter === "c" && !event.shiftKey) return run(state.copy);
        if (letter === "x" && !event.shiftKey) return run(state.cut);
        if (letter === "v" && event.shiftKey) return run(state.pasteInPlace);
        if (letter === "v") {
          event.stopPropagation();
          expectSystemPaste(useStudioStore.getState().paste);
          return;
        }
        if (letter === "d" && !event.shiftKey) return run(state.duplicate);
        if (letter === "a" && !event.shiftKey) return run(selectAll);
        if (letter === "g") return run(event.shiftKey ? ungroup : group);
        if (letter === "l" && event.shiftKey) return run(toggleLock);
        if (letter === "h" && event.shiftKey) return run(toggleHiddenSelection);
        if (letter === "r" && !event.shiftKey) return run(() => useViewPrefs.getState().toggle("rulers"));
        const zoom = zoomKey(event);
        if (zoom === "in") return run(() => state.setZoom(state.zoom * ZOOM_STEP));
        if (zoom === "out") return run(() => state.setZoom(state.zoom / ZOOM_STEP));
        if (zoom === "zero") return run(state.setFit);
        if (digitKey(event) === 1 && !event.shiftKey) return run(() => state.setZoom(1));
        const bracket = bracketKey(event);
        if (bracket === "right" || event.key === "ArrowUp") return run(() => reorder(event.shiftKey ? "front" : "forward"));
        if (bracket === "left" || event.key === "ArrowDown") return run(() => reorder(event.shiftKey ? "back" : "backward"));
        const texts = selectedElements(state).filter((element) => element.kind === "text");
        const step = fontSizeStep(event);
        if (step && texts.length) {
          return run(() => patchSelected((element) => (element.kind === "text" ? { fontSize: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(element.fontSize) + step)) } : {}), "font-size-shortcut"));
        }
        const style = letter ? STYLE_KEYS[letter] : undefined;
        if (style && !event.shiftKey && texts.length) {
          const next = !texts.every((element) => element.kind === "text" && element[style]);
          return run(() => patchSelected((element) => (element.kind === "text" ? withElementStyle(element, style === "bold" ? boldPatch(next) : { [style]: next }) : {})));
        }
        if (letter === "x" && event.shiftKey && texts.length) {
          const next = !texts.every((element) => element.kind === "text" && element.strike);
          return run(() => patchSelected((element) => (element.kind === "text" ? withElementStyle(element, { strike: next }) : {})));
        }
        const digit = digitKey(event);
        const list = event.shiftKey && digit !== null ? LIST_DIGITS[digit] : undefined;
        if (list && texts.length) {
          return run(() => patchSelected((element) => (element.kind === "text" ? { paragraphs: updateParagraphs(element, null, toggleList(element.paragraphs, list)) } : {})));
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isControlTarget(event.target) && CONTROL_KEYS.has(event.key)) return;
      if (event.key === "Delete" || event.key === "Backspace") return run(state.remove);
      if (event.key === "Escape" && state.selection.length) return run(() => (state.groupScope ? state.exitGroup() : state.select([])));
      if (event.key === "Enter" || event.key === "F2") {
        const [only] = selectedElements(state);
        if (only?.kind === "text" && state.selection.length === 1 && !only.locked) return run(() => state.setEditing(only.id));
        if (state.selection.length === 1 && croppable(only) && event.key === "Enter") return run(() => void beginCrop(only));
        if (only && state.selection.length === 1 && isGraphic(only) && !only.locked) return run(() => openGraphic(only));
        return;
      }
      if (event.key === "PageUp") return run(() => stepPage(-1));
      if (event.key === "PageDown") return run(() => stepPage(1));
      const arrow = ARROWS[event.key];
      if (arrow) {
        if (!state.selection.length) return;
        const distance = event.shiftKey ? NUDGE_FAR : NUDGE;
        return run(() => nudge(arrow[0] * distance, arrow[1] * distance));
      }
      if (event.shiftKey) {
        const digit = digitKey(event);
        if (digit === 1) return run(state.setFit);
        if (digit === 2) return run(() => canvasBridge.current?.zoomToSelection());
        const view = letter ? VIEW_KEYS[letter] : undefined;
        if (view) return run(() => useViewPrefs.getState().toggle(view));
        const flip = letter ? FLIP_KEYS[letter] : undefined;
        if (flip && state.selection.length) return run(() => flipSelection(flip));
        return;
      }
      const page = currentPage(state);
      if (!page || !letter) return;
      if (letter === "t") return run(() => insertText(page, BODY_PRESET, handlers.t(`studio.elements.${BODY_PRESET.key}Text`)));
      const shape = TOOL_SHAPES[letter];
      if (shape) return run(() => insertShape(page, shape));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const state = useStudioStore.getState();
      if (!state.design || isTextEntryTarget(event.target) || isCropping() || document.querySelector('[role="dialog"]')) return;
      const images = clipboardImages(event.clipboardData);
      if (!images.length) {
        if (claimSystemPaste()) {
          event.preventDefault();
          state.paste();
        }
        return;
      }
      event.preventDefault();
      claimSystemPaste();
      const { t } = latest.current;
      void pasteImageFiles(images, (error) => useToastStore.getState().push("error", describeError(t, toRpcError(error))));
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, []);
}
