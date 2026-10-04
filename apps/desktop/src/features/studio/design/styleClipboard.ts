import { create } from "zustand";
import { applyStyleToPage, extractStyle, type ElementStyle } from "./elementStyle";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";
import { textEditorBridge } from "./textEditorBridge";

type StyleClipboardState = { style: ElementStyle | null };

export const useStyleClipboard = create<StyleClipboardState>(() => ({ style: null }));

const studio = () => useStudioStore.getState();

export function copyStyle() {
  const state = studio();
  const elements = selectedElements(state);
  const source = elements.find((element) => element.id === state.selection[0]) ?? elements[0];
  if (source) useStyleClipboard.setState({ style: extractStyle(source) });
}

export function pasteStyle() {
  const style = useStyleClipboard.getState().style;
  textEditorBridge.current?.commit();
  const state = studio();
  const page = currentPage(state);
  if (!style || !page || !state.selection.length) return;
  const selection = state.selection;
  if (applyStyleToPage(page, selection, style) === page) return;
  state.applyToPage((current) => applyStyleToPage(current, selection, style));
}
