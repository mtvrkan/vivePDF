import { Extension, Node, type AnyExtension, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { CITATION } from "./citationItems";
import { citationNodes, type CitationSource } from "./citationNodes";
import { FOOTNOTE_PICTURE, footnoteMarkup, footnoteText, MAX_FOOTNOTE, MAX_FOOTNOTE_LINES, MAX_FOOTNOTE_PICTURE, MAX_FOOTNOTE_PICTURES } from "./footnotes";

const PICTURE = "image";
const HARD_BREAK = "hardBreak";
const RICH_NODES = new Set([CITATION, PICTURE]);

const NoteDocument = Node.create({ name: "doc", topNode: true, content: "paragraph" });

const NotePicture = Image.extend({
  parseHTML() {
    return [{ tag: "img[src]", getAttrs: (element) => (FOOTNOTE_PICTURE.test(element.getAttribute("src") ?? "") ? null : false) }];
  },
}).configure({ inline: true, allowBase64: true, HTMLAttributes: { class: "inline h-4 w-auto align-text-bottom" } });

type NoteSize = { text: number; breaks: number; pictures: number; oversized: boolean };

function noteSize(doc: ProseNode): NoteSize {
  const size: NoteSize = { text: doc.textContent.length, breaks: 0, pictures: 0, oversized: false };
  doc.descendants((node) => {
    if (node.type.name === HARD_BREAK) size.breaks += 1;
    if (node.type.name === PICTURE) {
      size.pictures += 1;
      const source = String(node.attrs.src ?? "");
      if (source.length > MAX_FOOTNOTE_PICTURE || !FOOTNOTE_PICTURE.test(source)) size.oversized = true;
    }
  });
  return size;
}

function fits(next: NoteSize, previous: NoteSize): boolean {
  if (next.oversized && !previous.oversized) return false;
  return next.text <= Math.max(MAX_FOOTNOTE, previous.text) && next.breaks <= Math.max(MAX_FOOTNOTE_LINES - 1, previous.breaks) && next.pictures <= Math.max(MAX_FOOTNOTE_PICTURES, previous.pictures);
}

const OneParagraph = Extension.create({
  name: "noteLine",
  priority: 1000,
  addKeyboardShortcuts() {
    return { Enter: () => true, "Mod-Enter": () => true };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: (transaction, state) => !transaction.docChanged || fits(noteSize(transaction.doc), noteSize(state.doc)) })];
  },
});

export function noteExtensions(placeholder: string, citations: CitationSource): AnyExtension[] {
  const [Citation] = citationNodes(citations);
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
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, protocols: ["mailto"] },
    }),
    NoteDocument,
    Subscript,
    Superscript,
    Citation,
    NotePicture,
    OneParagraph,
    Placeholder.configure({ placeholder }),
  ];
}

export function noteContent(text: string, html: string): JSONContent | string {
  const markup = footnoteMarkup(html);
  if (markup) return `<p>${markup}</p>`;
  const lines = footnoteText(text).split("\n");
  const content: JSONContent[] = lines.flatMap((line, index) => [...(index > 0 ? [{ type: HARD_BREAK }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
  return { type: "doc", content: [{ type: "paragraph", content: text ? content : [] }] };
}

export function noteValue(editor: Editor): { text: string; html: string } {
  const text = footnoteText(editor.getText());
  let rich = false;
  editor.state.doc.descendants((node) => {
    if (node.marks.length > 0 || RICH_NODES.has(node.type.name)) rich = true;
    return !rich;
  });
  const inner = editor.getHTML().replace(/^<p>/, "").replace(/<\/p>$/, "");
  return { text, html: rich ? footnoteMarkup(inner) : "" };
}
