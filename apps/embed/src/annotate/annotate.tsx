import { createPluginRegistration } from "@embedpdf/core";
import { AnnotationLayer, AnnotationPluginPackage, LockModeType } from "@embedpdf/plugin-annotation/preact";
import { ExportPluginPackage } from "@embedpdf/plugin-export/preact";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/preact";
import type { Lang } from "../i18n";
import { joiningInkHandler, type InkJoiner } from "./inkHandler";
import { NoteEditor, isNote } from "./NoteEditor";
import { ANNOTATION_COLORS } from "./tools";

export { AnnotateBar } from "./AnnotateBar";
export { createInkJoiner } from "./inkHandler";
export { useAnnotateSession } from "./useAnnotateSession";

const KEEP_DRAWING = { deactivateToolAfterCreate: false, selectAfterCreate: false };

export function annotatePlugins(joiner: InkJoiner) {
  const pointerHandler = joiningInkHandler(joiner);
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
        { id: "ink", behavior: KEEP_DRAWING, pointerHandler },
        { id: "inkHighlighter", behavior: KEEP_DRAWING, pointerHandler },
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
