import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { FOOTNOTE, footnoteText } from "./footnotes";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: { insertFootnote: () => ReturnType };
  }
}

export const Footnote = Node.create({
  name: FOOTNOTE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => footnoteText(element.getAttribute("data-footnote")),
        renderHTML: (attributes) => ({ "data-footnote": footnoteText(attributes.text) }),
      },
    };
  },
  parseHTML: () => [{ tag: "sup[data-footnote]", priority: 100 }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes, { class: "vp-footnote" })],
  renderText: () => "",
  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.nodes[this.name];
          if (!type) return false;
          if (dispatch) {
            const at = tr.selection.to;
            tr.insert(at, type.create({ text: "" }));
            tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Alt-f": () => this.editor.commands.insertFootnote() };
  },
});
