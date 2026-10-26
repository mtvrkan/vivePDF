import type { DocumentNode, DocumentSettings } from "@/types/studio";
import { textDirection } from "../model/design";
import { BIBLIOGRAPHY, CITATION, citationItems } from "./citationItems";
import type { Citations } from "./citations";
import { HeadingCounter } from "./headingCounter";
import { FOOTNOTE, FOOTNOTE_PICTURE, footnoteCitations, footnoteMarkup, footnoteText, MAX_FOOTNOTE_HTML, MAX_FOOTNOTES, noteCitation, unescapeAttribute } from "./footnotes";
import { SECTION_BREAK, sectionColumns, sectionKind } from "./sections";
import { SPACING_KEYS, spacingCss } from "./spacing";

export const PAGE_BREAK = "pageBreak";
export const MAX_DOCUMENT_FONTS = 16;
export const PX_TO_PT = 0.75;

const COLOUR = /^#[0-9a-f]{6}$/i;
const FONT_SIZE = /^(\d{1,3}(?:\.\d+)?)(pt|px)$/;
const SAFE_LINK = /^(https?:|mailto:|#)/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
const ALIGNS = new Set(["left", "center", "right", "justify"]);
const NOTE_CITATION = /<span\b[^>]*?\sdata-citation="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi;
const NOTE_PICTURE = /<img\b[^>]*>/gi;
const NOTE_SOURCE = /\ssrc="([^"]*)"/i;
const NOTE_ALT = /\salt="([^"]*)"/i;
const DEFAULT_HIGHLIGHT = "#fef08a";
const CHECKED = "&#9745;";
const UNCHECKED = "&#9744;";

export type DocumentHtml = { html: string; images: string[]; fonts: string[]; footnotes: string[]; footnoteHtml: string[]; blockIds: string[] };

export type DocumentReferences = { citations: Citations; title: string };

type Mark = NonNullable<DocumentNode["marks"]>[number];

type WriterSettings = Pick<DocumentSettings, "fontId" | "headingFontId"> & Partial<Pick<DocumentSettings, "headingNumbers">>;

class Writer {
  images: string[] = [];
  footnotes: string[] = [];
  footnoteHtml: string[] = [];
  fonts: string[];
  headings = 0;
  cited = 0;
  references: DocumentReferences | null;
  numbers: HeadingCounter;
  numbering = true;
  mainWritten = false;

  constructor(settings: WriterSettings, references: DocumentReferences | null) {
    this.fonts = [settings.fontId, settings.headingFontId ?? settings.fontId];
    this.references = references;
    this.numbers = new HeadingCounter(settings.headingNumbers ?? "none");
  }

  font(id: string): string | null {
    if (id === this.fonts[0]) return "f0";
    const index = this.fonts.indexOf(id, 2);
    if (index >= 0) return `f${index}`;
    if (this.fonts.length >= MAX_DOCUMENT_FONTS) return null;
    this.fonts.push(id);
    return `f${this.fonts.length - 1}`;
  }

  image(src: string): string | null {
    if (!DATA_IMAGE.test(src)) return null;
    let index = this.images.indexOf(src);
    if (index < 0) index = this.images.push(src) - 1;
    return `vpimg-${index}`;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attr(node: { attrs?: Record<string, unknown> }, name: string): unknown {
  return node.attrs?.[name];
}

function plainText(node: DocumentNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plainText).join("");
}

function fontSize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = FONT_SIZE.exec(value.trim());
  if (!match) return null;
  const points = match[2] === "px" ? Number(match[1]) * PX_TO_PT : Number(match[1]);
  return points >= 4 && points <= 200 ? `${Math.round(points * 10) / 10}pt` : null;
}

function styleMark(mark: Mark, writer: Writer): string[] {
  const styles: string[] = [];
  const color = attr(mark, "color");
  if (typeof color === "string" && COLOUR.test(color)) styles.push(`color:${color}`);
  const background = attr(mark, "backgroundColor");
  if (typeof background === "string" && COLOUR.test(background)) styles.push(`background-color:${background}`);
  const font = attr(mark, "fontId");
  const family = typeof font === "string" && font ? writer.font(font) : null;
  if (family) styles.push(`font-family:${family}`);
  const size = fontSize(attr(mark, "fontSize"));
  if (size) styles.push(`font-size:${size}`);
  return styles;
}

function wrap(text: string, mark: Mark, writer: Writer): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${text}</strong>`;
    case "italic":
      return `<em>${text}</em>`;
    case "underline":
      return `<u>${text}</u>`;
    case "strike":
      return `<s>${text}</s>`;
    case "code":
      return `<code>${text}</code>`;
    case "subscript":
      return `<sub>${text}</sub>`;
    case "superscript":
      return `<sup>${text}</sup>`;
    case "link": {
      const href = attr(mark, "href");
      return typeof href === "string" && SAFE_LINK.test(href.trim()) ? `<a href="${escapeHtml(href.trim())}">${text}</a>` : text;
    }
    case "highlight": {
      const color = attr(mark, "color");
      return `<span style="background-color:${typeof color === "string" && COLOUR.test(color) ? color : DEFAULT_HIGHLIGHT}">${text}</span>`;
    }
    case "textStyle": {
      const styles = styleMark(mark, writer);
      return styles.length ? `<span style="${styles.join(";")}">${text}</span>` : text;
    }
    default:
      return text;
  }
}

function blockStyle(node: DocumentNode): string {
  const align = attr(node, "textAlign");
  const styles = typeof align === "string" && ALIGNS.has(align) && align !== "left" ? [`text-align:${align}`] : [];
  for (const key of SPACING_KEYS) {
    const css = spacingCss(key, attr(node, key));
    if (css) styles.push(css);
  }
  return styles.length ? ` style="${styles.join(";")}"` : "";
}

function direction(node: DocumentNode): string {
  return textDirection(plainText(node)) === "rtl" ? ' dir="rtl"' : "";
}

function children(node: DocumentNode, writer: Writer): string {
  return (node.content ?? []).map((child) => write(child, writer)).join("");
}

function cell(node: DocumentNode, tag: "td" | "th", writer: Writer): string {
  const spans = ["colspan", "rowspan"]
    .map((name) => {
      const value = Number(attr(node, name));
      return Number.isInteger(value) && value > 1 ? ` ${name}="${value}"` : "";
    })
    .join("");
  const widths = attr(node, "colwidth");
  const width = Array.isArray(widths) && typeof widths[0] === "number" ? ` style="width:${Math.round(widths[0] * PX_TO_PT)}pt"` : "";
  return `<${tag}${spans}${width}>${children(node, writer)}</${tag}>`;
}

function taskItem(node: DocumentNode, writer: Writer): string {
  const box = `${attr(node, "checked") === true ? CHECKED : UNCHECKED} `;
  const inner = children(node, writer);
  const opening = /^<p\b[^>]*>/.exec(inner);
  return `<li>${opening ? `${opening[0]}${box}${inner.slice(opening[0].length)}` : `<p>${box}</p>${inner}`}</li>`;
}

function image(node: DocumentNode, writer: Writer): string {
  const src = attr(node, "src");
  const token = typeof src === "string" ? writer.image(src) : null;
  if (!token) return "";
  const width = Number(attr(node, "width"));
  const size = Number.isFinite(width) && width > 0 ? ` style="width:${Math.round(width * PX_TO_PT)}pt"` : "";
  const alt = attr(node, "alt");
  const label = typeof alt === "string" && alt ? ` alt="${escapeHtml(alt)}"` : "";
  return `<p style="text-align:center"><img src="${token}"${size}${label}></p>`;
}

function notePicture(tag: string, writer: Writer): string {
  const src = NOTE_SOURCE.exec(tag)?.[1] ?? "";
  const token = FOOTNOTE_PICTURE.test(src) ? writer.image(src) : null;
  if (!token) return "";
  const alt = unescapeAttribute(NOTE_ALT.exec(tag)?.[1] ?? "").trim();
  return `<img src="${token}"${alt ? ` alt="${escapeHtml(alt)}"` : ""}>`;
}

function noteHtml(markup: string, writer: Writer): string {
  const resolved = markup
    .replace(NOTE_CITATION, (_match, payload: string) => {
      const ordinal = writer.cited++;
      return writer.references ? writer.references.citations.label(noteCitation(payload), ordinal, true).html : "";
    })
    .replace(NOTE_PICTURE, (tag) => notePicture(tag, writer));
  return resolved.length <= MAX_FOOTNOTE_HTML ? resolved : "";
}

function footnoteMark(number: number): string {
  return `<sup class="fn-ref" id="fnref-${number}">${number}</sup>`;
}

function citation(node: DocumentNode, writer: Writer): string {
  const ordinal = writer.cited++;
  if (!writer.references) return "";
  const { citations } = writer.references;
  const label = citations.label(citationItems(attr(node, "items")), ordinal);
  if (!citations.notes) return label.html;
  if (writer.footnotes.length >= MAX_FOOTNOTES) return "";
  const number = writer.footnotes.push(label.text);
  writer.footnoteHtml.push(label.html);
  return footnoteMark(number);
}

function bibliography(writer: Writer): string {
  const references = writer.references;
  if (!references || references.citations.references.length === 0) return "";
  writer.headings += 1;
  const rows = references.citations.references.map((reference) => `<p class="ref">${reference}</p>`).join("");
  return `<div class="references"><h1 id="h-${writer.headings}">${escapeHtml(references.title)}</h1>${rows}</div>`;
}

function write(node: DocumentNode, writer: Writer): string {
  switch (node.type) {
    case "doc":
      return children(node, writer);
    case "text":
      return (node.marks ?? []).reduce((text, mark) => wrap(text, mark, writer), escapeHtml(node.text ?? ""));
    case "paragraph": {
      const inner = children(node, writer);
      return `<p${blockStyle(node)}${direction(node)}>${inner || "&nbsp;"}</p>`;
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attr(node, "level")) || 1));
      writer.headings += 1;
      const number = writer.numbering ? writer.numbers.next(level) : null;
      return `<h${level} id="h-${writer.headings}"${blockStyle(node)}${direction(node)}>${number ? `${escapeHtml(number)} ` : ""}${children(node, writer)}</h${level}>`;
    }
    case "hardBreak":
      return "<br>";
    case "bulletList":
      return `<ul>${children(node, writer)}</ul>`;
    case "orderedList": {
      const start = Number(attr(node, "start"));
      return `<ol${Number.isInteger(start) && start > 1 ? ` start="${start}"` : ""}>${children(node, writer)}</ol>`;
    }
    case "listItem":
      return `<li>${children(node, writer)}</li>`;
    case "taskList":
      return `<ul class="tasks">${children(node, writer)}</ul>`;
    case "taskItem":
      return taskItem(node, writer);
    case "blockquote":
      return `<blockquote>${children(node, writer)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(plainText(node))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image":
      return image(node, writer);
    case "table":
      return `<table>${children(node, writer)}</table>`;
    case "tableRow":
      return `<tr>${children(node, writer)}</tr>`;
    case "tableHeader":
      return cell(node, "th", writer);
    case "tableCell":
      return cell(node, "td", writer);
    case PAGE_BREAK:
      if (attr(node, "main") !== true || writer.mainWritten) return '<div class="page-break"></div>';
      writer.mainWritten = true;
      writer.numbering = true;
      return '<div class="page-break" data-main="true"></div>';
    case SECTION_BREAK:
      return `<div class="section-break" data-columns="${sectionColumns(attr(node, "columns"))}"${sectionKind(attr(node, "kind")) ? ' data-kind="continuous"' : ""}></div>`;
    case FOOTNOTE: {
      const markup = footnoteMarkup(attr(node, "html"));
      const after = writer.cited + footnoteCitations(markup).length;
      if (writer.footnotes.length >= MAX_FOOTNOTES) {
        writer.cited = after;
        return "";
      }
      const number = writer.footnotes.push(footnoteText(attr(node, "text")));
      writer.footnoteHtml.push(noteHtml(markup, writer));
      writer.cited = after;
      return footnoteMark(number);
    }
    case CITATION:
      return citation(node, writer);
    case BIBLIOGRAPHY:
      return bibliography(writer);
    default:
      return children(node, writer);
  }
}

function hasMainBreak(node: DocumentNode): boolean {
  return (node.type === PAGE_BREAK && attr(node, "main") === true) || (node.content ?? []).some(hasMainBreak);
}

const OPENING_TAG = /^<([a-z][a-z0-9]*)(?=[\s>])/;
const UNMARKED_BLOCKS = new Set([PAGE_BREAK, SECTION_BREAK]);

function markedBlock(node: DocumentNode, markup: string, index: number, writer: Writer): { markup: string; id: string } {
  if (node.type === "heading") return { markup, id: `h-${writer.headings}` };
  if (UNMARKED_BLOCKS.has(node.type) || !OPENING_TAG.test(markup)) return { markup, id: "" };
  const id = `b-${index}`;
  return { markup: markup.replace(OPENING_TAG, `<$1 id="${id}"`), id };
}

export function documentHtml(content: DocumentNode, settings: WriterSettings, references: DocumentReferences | null = null, markBlocks = false): DocumentHtml {
  const writer = new Writer(settings, references);
  writer.numbering = !hasMainBreak(content);
  const blockIds: string[] = [];
  const html =
    markBlocks && content.type === "doc"
      ? (content.content ?? [])
          .map((child, index) => {
            const marked = markedBlock(child, write(child, writer), index, writer);
            blockIds.push(marked.id);
            return marked.markup;
          })
          .join("")
      : write(content, writer);
  return { html, images: writer.images, fonts: writer.fonts, footnotes: writer.footnotes, footnoteHtml: writer.footnoteHtml, blockIds };
}
