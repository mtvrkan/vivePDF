import type { Lang } from "../i18n";
import type { AnnotateTool } from "./tools";

type Messages = {
  bar: string;
  tools: Record<AnnotateTool, string>;
  colors: string;
  colorNames: [string, string, string, string, string, string];
  width: string;
  widthNames: [string, string, string];
  undo: string;
  redo: string;
  remove: string;
  close: string;
  textHint: string;
  noteLabel: string;
  notePlaceholder: string;
};

const en: Messages = {
  bar: "Drawing tools",
  tools: {
    ink: "Pen",
    inkHighlighter: "Marker",
    highlight: "Highlight text",
    underline: "Underline text",
    strikeout: "Strike out text",
    textComment: "Note",
    square: "Rectangle",
    circle: "Ellipse",
    lineArrow: "Arrow",
  },
  colors: "Colour",
  colorNames: ["Red", "Yellow", "Green", "Blue", "Purple", "Black"],
  width: "Line width",
  widthNames: ["Thin", "Medium", "Thick"],
  undo: "Undo",
  redo: "Redo",
  remove: "Delete selected",
  close: "Close drawing tools",
  textHint: "Drag over the text",
  noteLabel: "Note text",
  notePlaceholder: "Write your note",
};

const tr: Messages = {
  bar: "Çizim araçları",
  tools: {
    ink: "Kalem",
    inkHighlighter: "Fosforlu kalem",
    highlight: "Metni vurgula",
    underline: "Metnin altını çiz",
    strikeout: "Metnin üstünü çiz",
    textComment: "Not",
    square: "Dikdörtgen",
    circle: "Elips",
    lineArrow: "Ok",
  },
  colors: "Renk",
  colorNames: ["Kırmızı", "Sarı", "Yeşil", "Mavi", "Mor", "Siyah"],
  width: "Çizgi kalınlığı",
  widthNames: ["İnce", "Orta", "Kalın"],
  undo: "Geri al",
  redo: "Yinele",
  remove: "Seçileni sil",
  close: "Çizim araçlarını kapat",
  textHint: "Metnin üzerinden sürükleyin",
  noteLabel: "Not metni",
  notePlaceholder: "Notunuzu yazın",
};

export const ANNOTATE_MESSAGES: Record<Lang, Messages> = { en, tr };
