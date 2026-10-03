import type { DocumentNode, DocumentSettings } from "@/types/studio";
import { textDirection } from "../model/design";

export const PAGE_BREAK = "pageBreak";
export const MAX_DOCUMENT_FONTS = 16;
export const PX_TO_PT = 0.75;

const COLOUR = /^#[0-9a-f]{6}$/i;
const FONT_SIZE = /^(\d{1,3}(?:\.\d+)?)(pt|px)$/;
const SAFE_LINK = /^(https?:|mailto:|#)/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i;
const ALIGNS = new Set(["left", "center", "right", "justify"]);
const DEFAULT_HIGHLIGHT = "#fef08a";
const CHECKED = "&#9745;";
const UNCHECKED = "&#9744;";

export type DocumentHtml = { html: string; images: string[]; fonts: string[] };

type Mark = NonNullable<DocumentNode["marks"]>[number];

class Writer {
  images: string[] = [];
  fonts: string[];
  headings = 0;

  constructor(settings: Pick<DocumentSettings, "fontId" | "headingFontId">) {
    this.fonts = [settings.fontId, settings.headingFontId ?? settings.fontId];
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
  return typeof align === "string" && ALIGNS.has(align) && align !== "left" ? ` style="text-align:${align}"` : "";
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
      return `<h${level} id="h-${writer.headings}"${blockStyle(node)}${direction(node)}>${children(node, writer)}</h${level}>`;
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
      return '<div class="page-break"></div>';
    default:
      return children(node, writer);
  }
}

export function documentHtml(content: DocumentNode, settings: Pick<DocumentSettings, "fontId" | "headingFontId">): DocumentHtml {
  const writer = new Writer(settings);
  const html = write(content, writer);
  return { html, images: writer.images, fonts: writer.fonts };
}
