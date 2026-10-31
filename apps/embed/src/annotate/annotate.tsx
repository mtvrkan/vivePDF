import { createPluginRegistration } from "@embedpdf/core";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { AnnotationLayer, AnnotationPluginPackage, LockModeType } from "@embedpdf/plugin-annotation/preact";
import { ExportPluginPackage } from "@embedpdf/plugin-export/preact";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/preact";
import type { Lang } from "../i18n";
import { DrawingMenu } from "./DrawingMenu";
import { erasingHandler, joiningInkHandler, type InkTools } from "./inkHandler";
import { NoteEditor, isNote } from "./NoteEditor";
import { ANNOTATION_COLORS } from "./tools";

export { AnnotateBar } from "./AnnotateBar";
export { createInkTools } from "./inkHandler";
export { useAnnotateSession } from "./useAnnotateSession";

const KEEP_DRAWING = { deactivateToolAfterCreate: false, selectAfterCreate: false };
const ONE_SHOT = { deactivateToolAfterCreate: true, selectAfterCreate: true };

export function annotatePlugins(inkTools: InkTools) {
  const pointerHandler = joiningInkHandler(inkTools);
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
        { id: "square", behavior: ONE_SHOT },
        { id: "circle", behavior: ONE_SHOT },
        { id: "lineArrow", behavior: ONE_SHOT },
        {
          id: "eraser",
          name: "Eraser",
          matchScore: () => 0,
          defaults: { type: PdfAnnotationSubtype.INK },
          interaction: { exclusive: false, cursor: "crosshair" },
          behavior: KEEP_DRAWING,
          pointerHandler: erasingHandler(inkTools),
        },
      ],
    }),
    createPluginRegistration(ExportPluginPackage, { defaultFileName: "document.pdf" }),
  ];
}

export function AnnotatePageLayer({ documentId, pageIndex, lang }: { documentId: string; pageIndex: number; lang: Lang }) {
  return (
    <div data-annotation-layer style={{ display: "contents" }}>
      <AnnotationLayer
        documentId={documentId}
        pageIndex={pageIndex}
        selectionOutline={{ color: "var(--vp-primary)" }}
        resizeUI={{ color: "var(--vp-primary)" }}
        selectionMenu={(menu) => {
          if (!menu.selected) return null;
          return isNote(menu) ? <NoteEditor documentId={documentId} lang={lang} menu={menu} /> : <DrawingMenu documentId={documentId} lang={lang} menu={menu} />;
        }}
      />
    </div>
  );
}
