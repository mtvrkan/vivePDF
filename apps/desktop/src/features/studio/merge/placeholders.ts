import { createText } from "../model/design";
import { addElements, updateElement } from "../model/edit";
import { currentPage, useStudioStore } from "../design/studioStore";
import { textEditorBridge } from "../design/textEditorBridge";

const NEW_TEXT_SIZE = 24;

export function placeholderToken(name: string): string {
  return `{${name}}`;
}

export function insertPlaceholder(name: string) {
  const token = placeholderToken(name);
  const store = useStudioStore.getState();
  const bridge = textEditorBridge.current;
  if (store.editingId && bridge) {
    bridge.insert(token);
    return;
  }
  const page = currentPage(store);
  if (!page) return;
  const selected = store.selection.length === 1 ? page.elements.find((element) => element.id === store.selection[0]) : undefined;
  if (selected?.kind === "text" && !selected.locked) {
    const runs = selected.runs.length ? selected.runs : [{ text: "" }];
    const last = runs[runs.length - 1];
    const glue = last.text && !/\s$/.test(last.text) ? " " : "";
    store.applyToPage((current) => updateElement(current, selected.id, { runs: [...runs.slice(0, -1), { ...last, text: `${last.text}${glue}${token}` }] }));
    return;
  }
  if (selected?.kind === "qr" && !selected.locked) {
    store.applyToPage((current) => updateElement(current, selected.id, { value: `${selected.value}${token}` }));
    return;
  }
  const width = Math.min(page.width - NEW_TEXT_SIZE * 2, Math.max(page.width / 2, token.length * NEW_TEXT_SIZE * 0.7));
  const height = Math.ceil(NEW_TEXT_SIZE * 1.3);
  const element = createText((page.width - width) / 2, (page.height - height) / 2, width, height, token, { fontSize: NEW_TEXT_SIZE, align: "center" });
  store.applyToPage((current) => addElements(current, [element]));
  store.select([element.id]);
}
