import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { FOOTNOTE, footnoteMarkup, footnoteText } from "./footnotes";

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
      html: {
        default: "",
        parseHTML: (element) => footnoteMarkup(element.getAttribute("data-footnote-html")),
        renderHTML: (attributes) => {
          const markup = footnoteMarkup(attributes.html);
          return markup ? { "data-footnote-html": markup } : {};
        },
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
            tr.insert(at, type.create({ text: "", html: "" }));
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
