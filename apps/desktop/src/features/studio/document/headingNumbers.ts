import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocumentHeadingNumbers } from "@/types/studio";
import { HeadingCounter } from "./headingCounter";

export function headingLabels(doc: ProseNode, style: DocumentHeadingNumbers): Map<number, string> {
  const counter = new HeadingCounter(style);
  const labels = new Map<number, string>();
  if (style === "none") return labels;
  doc.descendants((node, position) => {
    if (node.type.name !== "heading") return true;
    const label = counter.next(Number(node.attrs.level) || 1);
    if (label) labels.set(position, label);
    return false;
  });
  return labels;
}

type NumbersState = { style: DocumentHeadingNumbers; decorations: DecorationSet };

export const headingNumbersKey = new PluginKey<NumbersState>("documentHeadingNumbers");

function numberWidget(label: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "vp-heading-number";
  span.contentEditable = "false";
  span.textContent = `${label} `;
  return span;
}

function build(doc: ProseNode, style: DocumentHeadingNumbers): NumbersState {
  const widgets = [...headingLabels(doc, style)].map(([position, label]) => Decoration.widget(position + 1, () => numberWidget(label), { side: -1, key: `${label}@${position}`, ignoreSelection: true }));
  return { style, decorations: widgets.length ? DecorationSet.create(doc, widgets) : DecorationSet.empty };
}

export function setHeadingNumbers(state: EditorState, style: DocumentHeadingNumbers) {
  return state.tr.setMeta(headingNumbersKey, style).setMeta("addToHistory", false);
}

export const HeadingNumbers = Extension.create<{ initial: () => DocumentHeadingNumbers }>({
  name: "headingNumbers",
  addOptions() {
    return { initial: () => "none" };
  },
  addProseMirrorPlugins() {
    const initial = this.options.initial;
    return [
      new Plugin<NumbersState>({
        key: headingNumbersKey,
        state: {
          init: (_, state) => build(state.doc, initial()),
          apply: (tr, value, _, state) => {
            const style = tr.getMeta(headingNumbersKey) as DocumentHeadingNumbers | undefined;
            if (style !== undefined) return build(state.doc, style);
            return tr.docChanged ? build(state.doc, value.style) : value;
          },
        },
        props: { decorations: (state) => headingNumbersKey.getState(state)?.decorations },
      }),
    ];
  },
});
