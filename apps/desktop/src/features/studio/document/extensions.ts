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
import { citationNodes, type CitationSource } from "./citationNodes";
import { fontStack } from "./documentFonts";
import { DocumentFind } from "./findInDocument";
import { Footnote } from "./footnoteNode";
import { ParagraphSpacing } from "./paragraphSpacing";
import { SECTION_BREAK, sectionColumns } from "./sections";
import { PAGE_BREAK } from "./toHtml";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType };
    sectionBreak: { setSectionBreak: (columns: number) => ReturnType };
    fontId: { setFontId: (fontId: string) => ReturnType; unsetFontId: () => ReturnType };
  }
}

export const PageBreak = Node.create({
  name: PAGE_BREAK,
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }, { tag: "div.page-break" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "page-break", "data-page-break": "" })],
  addCommands() {
    return { setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.setPageBreak() };
  },
});

export type SectionLabel = (columns: number) => string;

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
    };
  },
  parseHTML: () => [{ tag: "div[data-section-break]" }, { tag: "div.section-break" }],
  renderHTML({ node, HTMLAttributes }) {
    const label = this.options.label(sectionColumns(node.attrs.columns));
    return ["div", mergeAttributes(HTMLAttributes, { class: "section-break", "data-section-break": "", "data-label": label, role: "separator", "aria-label": label })];
  },
  addCommands() {
    return { setSectionBreak: (columns) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { columns: sectionColumns(columns) } }) };
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

export function documentExtensions(placeholder: string, citations: CitationSource, sectionLabel?: SectionLabel): AnyExtension[] {
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
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: true, resize: { enabled: true, minWidth: 32, minHeight: 32, alwaysPreserveAspectRatio: true } }),
    PageBreak,
    sectionLabel ? SectionBreak.configure({ label: sectionLabel }) : SectionBreak,
    Footnote,
    ...citationNodes(citations),
    Placeholder.configure({ placeholder }),
  ];
}
