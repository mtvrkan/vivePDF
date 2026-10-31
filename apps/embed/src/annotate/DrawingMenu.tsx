import { useAnnotation, type AnnotationSelectionMenuProps } from "@embedpdf/plugin-annotation/preact";
import type { Lang } from "../i18n";
import { AnnotateIcon } from "./AnnotateIcon";
import { ANNOTATE_MESSAGES } from "./messages";

type DrawingMenuProps = { documentId: string; lang: Lang; menu: AnnotationSelectionMenuProps };

export function DrawingMenu({ documentId, lang, menu }: DrawingMenuProps) {
  const text = ANNOTATE_MESSAGES[lang];
  const { provides: scope } = useAnnotation(documentId);
  if (menu.context.structurallyLocked) return null;
  const remove = () => {
    const chosen = scope?.getSelectedAnnotations().map((item) => ({ pageIndex: item.object.pageIndex, id: item.object.id })) ?? [];
    if (chosen.length > 0) scope?.deleteAnnotations(chosen);
  };

  return (
    <div {...menu.menuWrapperProps}>
      <div class="vp-drawing-menu vp-glass" onPointerDown={(event) => event.stopPropagation()}>
        <button class="vp-btn vp-btn-text" type="button" onClick={remove}>
          <AnnotateIcon name="remove" />
          <span>{text.removeOne}</span>
        </button>
      </div>
    </div>
  );
}
