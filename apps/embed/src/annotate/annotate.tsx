import { createPluginRegistration } from "@embedpdf/core";
import { AnnotationLayer, AnnotationPluginPackage, LockModeType } from "@embedpdf/plugin-annotation/preact";
import { ExportPluginPackage } from "@embedpdf/plugin-export/preact";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/preact";
import type { Lang } from "../i18n";
import { NoteEditor, isNote } from "./NoteEditor";
import { ANNOTATION_COLORS } from "./tools";

export { AnnotateBar } from "./AnnotateBar";
export { useAnnotateSession } from "./useAnnotateSession";

const SAVE_STROKE_AT_ONCE = { commitDelay: 0, deactivateToolAfterCreate: false };

export function annotatePlugins() {
  return [
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      annotationAuthor: "",
      colorPresets: [...ANNOTATION_COLORS],
      autoCommit: true,
      selectAfterCreate: true,
      deactivateToolAfterCreate: false,
      autoOpenLinks: false,
      locked: { type: LockModeType.None },
      tools: [
        { id: "ink", behavior: SAVE_STROKE_AT_ONCE },
        { id: "inkHighlighter", behavior: SAVE_STROKE_AT_ONCE },
      ],
    }),
    createPluginRegistration(ExportPluginPackage, { defaultFileName: "document.pdf" }),
  ];
}

export function AnnotatePageLayer({ documentId, pageIndex, lang }: { documentId: string; pageIndex: number; lang: Lang }) {
  return (
    <AnnotationLayer
      documentId={documentId}
      pageIndex={pageIndex}
      selectionOutline={{ color: "var(--vp-primary)" }}
      selectionMenu={(menu) => (menu.selected && isNote(menu) ? <NoteEditor documentId={documentId} lang={lang} menu={menu} /> : null)}
    />
  );
}
