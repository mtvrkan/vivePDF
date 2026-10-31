import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { PdfAnnotationSubtype } from "@embedpdf/models";
import { useAnnotation, type AnnotationSelectionMenuProps } from "@embedpdf/plugin-annotation/preact";
import type { Lang } from "../i18n";
import { ANNOTATE_MESSAGES } from "./messages";
import { NOTE_MAX_LENGTH } from "./tools";

type NoteEditorProps = { documentId: string; lang: Lang; menu: AnnotationSelectionMenuProps };

const openDrafts = new Set<() => void>();

export function commitNoteDrafts(): void {
  for (const commit of [...openDrafts]) commit();
}

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
  const latest = useRef({ draft, saved, pageIndex: menu.context.pageIndex, locked: menu.context.structurallyLocked, scope });
  latest.current = { draft, saved, pageIndex: menu.context.pageIndex, locked: menu.context.structurallyLocked, scope };
  const commit = useCallback(() => {
    const { draft: typed, saved: stored, pageIndex, locked, scope: target } = latest.current;
    const tracked = target?.getState().byUid[note.id];
    if (typed === stored || locked || !target || !tracked || tracked.commitState === "deleted") return;
    latest.current.saved = typed;
    target.updateAnnotation(pageIndex, note.id, { contents: typed });
  }, [note.id]);
  useEffect(() => {
    openDrafts.add(commit);
    return () => {
      openDrafts.delete(commit);
      commit();
    };
  }, [commit]);

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
