import { Extension, Node, type AnyExtension, type Editor, type JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { footnoteMarkup, footnoteText, MAX_FOOTNOTE } from "./footnotes";

const NoteDocument = Node.create({ name: "doc", topNode: true, content: "paragraph" });

const OneLine = Extension.create({
  name: "noteLine",
  addKeyboardShortcuts() {
    return { Enter: () => true, "Shift-Enter": () => true, "Mod-Enter": () => true };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: (transaction, state) => !transaction.docChanged || transaction.doc.textContent.length <= Math.max(MAX_FOOTNOTE, state.doc.textContent.length) })];
  },
});

export function noteExtensions(placeholder: string): AnyExtension[] {
  return [
    StarterKit.configure({
      document: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      hardBreak: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, protocols: ["mailto"] },
    }),
    NoteDocument,
    Subscript,
    Superscript,
    OneLine,
    Placeholder.configure({ placeholder }),
  ];
}

export function noteContent(text: string, html: string): JSONContent | string {
  const markup = footnoteMarkup(html);
  if (markup) return `<p>${markup}</p>`;
  return { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
}

export function noteValue(editor: Editor): { text: string; html: string } {
  const text = footnoteText(editor.getText());
  let marked = false;
  editor.state.doc.descendants((node) => {
    if (node.marks.length > 0) marked = true;
    return !marked;
  });
  const inner = editor.getHTML().replace(/^<p>/, "").replace(/<\/p>$/, "");
  return { text, html: marked ? footnoteMarkup(inner) : "" };
}
