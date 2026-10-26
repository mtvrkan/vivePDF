import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocumentCaptionKind } from "@/types/studio";
import { CAPTION, CaptionCounter, captionKind, captionLabel } from "./captionCounter";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    caption: { insertCaption: (kind: DocumentCaptionKind, label: string) => ReturnType };
  }
}

export function captionLabels(doc: ProseNode): Map<number, string> {
  const counter = new CaptionCounter();
  const labels = new Map<number, string>();
  doc.descendants((node, position) => {
    if (node.type.name !== CAPTION) return true;
    const kind = captionKind(node.attrs.kind);
    labels.set(position, captionLabel(node.attrs.label, kind, counter.next(kind)));
    return false;
  });
  return labels;
}

function numberWidget(label: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "vp-caption-number";
  span.contentEditable = "false";
  span.textContent = `${label} `;
  return span;
}

function decorations(doc: ProseNode): DecorationSet {
  const widgets = [...captionLabels(doc)].map(([position, label]) => Decoration.widget(position + 1, () => numberWidget(label), { side: -1, key: `${label}@${position}`, ignoreSelection: true }));
  return widgets.length ? DecorationSet.create(doc, widgets) : DecorationSet.empty;
}

export function captionPosition(state: EditorState, kind: DocumentCaptionKind): number {
  const { selection } = state;
  const { $from } = selection;
  if (kind === "table") {
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === "table") return $from.before(depth);
    }
  }
  if ($from.depth === 0) return selection.to;
  return $from.after(1);
}

const captionNumbersKey = new PluginKey<DecorationSet>("documentCaptionNumbers");

export const Caption = Node.create({
  name: CAPTION,
  group: "block",
  content: "inline*",
  addAttributes() {
    return {
      kind: {
        default: "figure",
        parseHTML: (element) => captionKind(element.getAttribute("data-caption")),
        renderHTML: (attributes) => ({ "data-caption": captionKind(attributes.kind) }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes) => (attributes.label ? { "data-label": attributes.label } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "p[data-caption]", priority: 60 }],
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes, { class: "vp-caption" }), 0];
  },
  addCommands() {
    return {
      insertCaption:
        (kind, label) =>
        ({ state, chain }) => {
          const position = captionPosition(state, kind);
          return chain()
            .insertContentAt(position, { type: this.name, attrs: { kind, label } })
            .setTextSelection(position + 1)
            .run();
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: captionNumbersKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, value, _, state) => (tr.docChanged ? decorations(state.doc) : value),
        },
        props: { decorations: (state) => captionNumbersKey.getState(state) },
      }),
    ];
  },
});
