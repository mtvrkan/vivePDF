import { Extension, Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { BackgroundColor, Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { Caption } from "./captionNode";
import { citationNodes, type CitationSource } from "./citationNodes";
import { fontStack } from "./documentFonts";
import { commentExtensions } from "./commentMark";
import { useCommentsView } from "./commentsView";
import { trackChangesExtensions } from "./trackChangesMark";
import { equationNodes } from "./equationNodes";
import { DocumentFind } from "./findInDocument";
import { Footnote } from "./footnoteNode";
import { HeadingNumbers } from "./headingNumbers";
import { useDocumentStore } from "./documentStore";
import { ParagraphSpacing } from "./paragraphSpacing";
import { CONTINUOUS, SECTION_BREAK, sectionColumns, sectionKind } from "./sections";
import { PAGE_BREAK } from "./toHtml";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType; setMainMatterBreak: () => ReturnType };
    sectionBreak: { setSectionBreak: (columns: number, continuous?: boolean) => ReturnType };
    fontId: { setFontId: (fontId: string) => ReturnType; unsetFontId: () => ReturnType };
  }
}

export const PageBreak = Node.create<{ mainLabel: string }>({
  name: PAGE_BREAK,
  group: "block",
  atom: true,
  selectable: true,
  addOptions: () => ({ mainLabel: "" }),
  addAttributes() {
    return {
      main: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-main") === "true",
        renderHTML: (attributes) => (attributes.main ? { "data-main": "true" } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-page-break]" }, { tag: "div.page-break" }],
  renderHTML({ node, HTMLAttributes }) {
    const marked = node.attrs.main ? { "data-label": this.options.mainLabel, role: "separator", "aria-label": this.options.mainLabel } : {};
    return ["div", mergeAttributes(HTMLAttributes, { class: "page-break", "data-page-break": "" }, marked)];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }),
      setMainMatterBreak:
        () =>
        ({ tr, commands }) => {
          tr.doc.descendants((node, position) => {
            if (node.type.name === this.name && node.attrs.main) tr.setNodeMarkup(position, undefined, { ...node.attrs, main: false });
          });
          return commands.insertContent({ type: this.name, attrs: { main: true } });
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

export type SectionLabel = (columns: number, continuous: boolean) => string;

export const SectionBreak = Node.create<{ label: SectionLabel }>({
  name: SECTION_BREAK,
  group: "block",
  atom: true,
  selectable: true,
  addOptions: () => ({ label: (columns: number) => String(columns) }),
  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (element) => sectionColumns(element.getAttribute("data-columns")),
        renderHTML: (attributes) => ({ "data-columns": String(sectionColumns(attributes.columns)) }),
      },
      kind: {
        default: undefined,
        parseHTML: (element) => sectionKind(element.getAttribute("data-kind")),
        renderHTML: (attributes) => (sectionKind(attributes.kind) ? { "data-kind": CONTINUOUS } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-section-break]" }, { tag: "div.section-break" }],
  renderHTML({ node, HTMLAttributes }) {
    const label = this.options.label(sectionColumns(node.attrs.columns), sectionKind(node.attrs.kind) === CONTINUOUS);
    return ["div", mergeAttributes(HTMLAttributes, { class: "section-break", "data-section-break": "", "data-label": label, role: "separator", "aria-label": label })];
  },
  addCommands() {
    return {
      setSectionBreak:
        (columns, continuous = false) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: continuous ? { columns: sectionColumns(columns), kind: CONTINUOUS } : { columns: sectionColumns(columns) } }),
    };
  },
});

export const FontId = Extension.create({
  name: "fontId",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-font-id"),
            renderHTML: (attributes) => (typeof attributes.fontId === "string" && attributes.fontId ? { "data-font-id": attributes.fontId, style: `font-family: ${fontStack(attributes.fontId)}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontId:
        (fontId) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontId }).run(),
      unsetFontId:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontId: null }).removeEmptyTextStyle().run(),
    };
  },
});

export function documentExtensions(placeholder: string, citations: CitationSource, sectionLabel?: SectionLabel, mainLabel = ""): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ["mailto"] } }),
    TextStyle,
    Color,
    BackgroundColor,
    FontSize,
    FontId,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    ParagraphSpacing,
    DocumentFind,
    HeadingNumbers.configure({ initial: () => useDocumentStore.getState().document?.settings.headingNumbers ?? "none" }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: true, resize: { enabled: true, minWidth: 32, minHeight: 32, alwaysPreserveAspectRatio: true } }),
    PageBreak.configure({ mainLabel }),
    Caption,
    sectionLabel ? SectionBreak.configure({ label: sectionLabel }) : SectionBreak,
    Footnote,
    ...equationNodes(),
    ...commentExtensions(),
    ...trackChangesExtensions(() => useCommentsView.getState().author),
    ...citationNodes(citations),
    Placeholder.configure({ placeholder }),
  ];
}
