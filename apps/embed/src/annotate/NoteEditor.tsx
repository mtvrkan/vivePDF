import { useEffect, useRef, useState } from "preact/hooks";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { useAnnotation, type AnnotationSelectionMenuProps } from "@embedpdf/plugin-annotation/preact";
import type { Lang } from "../i18n";
import { ANNOTATE_MESSAGES } from "./messages";

export const NOTE_MAX_LENGTH = 2000;

type NoteEditorProps = { documentId: string; lang: Lang; menu: AnnotationSelectionMenuProps };

export function NoteEditor({ documentId, lang, menu }: NoteEditorProps) {
  const text = ANNOTATE_MESSAGES[lang];
  const { provides: scope } = useAnnotation(documentId);
  const note = menu.context.annotation.object;
  const saved = typeof note.contents === "string" ? note.contents : "";
  const [draft, setDraft] = useState(saved);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => {
    if (saved === "") fieldRef.current?.focus();
  }, [note.id, saved]);
  const commit = () => {
    if (draft !== saved && !menu.context.structurallyLocked) scope?.updateAnnotation(menu.context.pageIndex, note.id, { contents: draft });
  };

  return (
    <div {...menu.menuWrapperProps}>
      <div class="vp-note-editor vp-glass" style={{ top: `${menu.rect.size.height + 8}px` }} onPointerDown={(event) => event.stopPropagation()}>
        <textarea
          ref={fieldRef}
          aria-label={text.noteLabel}
          placeholder={text.notePlaceholder}
          maxLength={NOTE_MAX_LENGTH}
          value={draft}
          readOnly={menu.context.structurallyLocked}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>
    </div>
  );
}

export function isNote(menu: AnnotationSelectionMenuProps): boolean {
  return menu.context.annotation.object.type === PdfAnnotationSubtype.TEXT;
}
