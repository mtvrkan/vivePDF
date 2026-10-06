import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { CornerDownRight, ExternalLink, StickyNote, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnnotationLayer, useAnnotation } from "@embedpdf/plugin-annotation/react";
import { internalLinkOf, linkUriOf } from "./annotationLink";
import { isOpenableUri } from "./linkUri";
import { IconButton } from "@/components/shared/IconButton";
import { openExternal } from "@/shared/lib/openExternal";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { usePageNavigation } from "./usePageNavigation";

const MENU_Z_INDEX = 60;

type SelectionMenuProps = Parameters<NonNullable<ComponentProps<typeof AnnotationLayer>["selectionMenu"]>>[0];

export function AnnotationSelectionMenu({ documentId, ...props }: SelectionMenuProps & { documentId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const { provides: annotation } = useAnnotation(documentId);
  const { selected, menuWrapperProps, context } = props;
  const object = context.annotation.object;
  const note = "contents" in object ? (object.contents ?? "") : "";
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState(note);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const { followLink } = usePageNavigation(documentId);
  const annotatePanel = useViewerPanelsStore((state) => state.panels.annotate);
  const immersive = useUiStore((state) => state.immersive);
  const presentationAnnotations = usePresentationStore((state) => state.drawingsMode === "annotations");
  const editing = immersive ? presentationAnnotations : annotatePanel;
  const internal = internalLinkOf(object);
  const followNow = selected && internal !== null && !editing;

  const followRef = useRef({ internal, followLink, annotation });
  followRef.current = { internal, followLink, annotation };

  useEffect(() => {
    const { internal: link, followLink: follow, annotation: scope } = followRef.current;
    if (!followNow || !link) return;
    scope?.deselectAnnotation();
    follow(link.target, link.pageIndex);
  }, [followNow]);

  useEffect(() => {
    setDraft(note);
  }, [note]);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  if (!selected || followNow) return null;

  const wrapperStyle = (menuWrapperProps as { style?: CSSProperties }).style;
  const raw = linkUriOf(object);
  const uri = raw && isOpenableUri(raw) ? raw : null;
  const showEditing = editing || (!uri && !internal);

  const open = () => {
    if (!uri) return;
    void openExternal(uri).catch(() => toast("error", t("viewer.link.openFailed")));
  };

  const remove = () => annotation?.deleteAnnotation(object.pageIndex, object.id);

  const commitNote = () => {
    if (draft === note) return;
    annotation?.updateAnnotation(object.pageIndex, object.id, { contents: draft, author: object.author });
  };

  const closeNote = () => {
    commitNote();
    setNoteOpen(false);
  };

  return (
    <div {...menuWrapperProps} data-annotation-menu style={{ ...wrapperStyle, zIndex: MENU_Z_INDEX, pointerEvents: "none" }}>
      <div className="glass-menu pointer-events-auto absolute start-0 top-full mt-3 inline-flex w-max max-w-[min(80vw,22rem)] flex-col gap-1 rounded-xl p-1">
        <div className="flex items-center gap-1">
          {uri ? (
            <>
              <span className="min-w-0 flex-1 truncate px-1.5 font-mono text-[11px] text-muted-foreground" title={uri}>
                {uri}
              </span>
              <IconButton icon={ExternalLink} label={t("viewer.link.open")} onClick={open} />
            </>
          ) : null}
          {internal ? (
            <IconButton
              icon={CornerDownRight}
              label={t("viewer.link.goToPage", { page: internal.pageIndex + 1 })}
              onClick={() => {
                annotation?.deselectAnnotation();
                followLink(internal.target, internal.pageIndex);
              }}
            />
          ) : null}
          {showEditing ? (
            <>
              <IconButton
                icon={StickyNote}
                label={t("annotate.note")}
                active={noteOpen}
                disabled={context.contentLocked}
                onClick={() => (noteOpen ? closeNote() : setNoteOpen(true))}
                className={note && !noteOpen ? "text-primary" : undefined}
              />
              <IconButton icon={Trash2} label={t("common.delete")} onClick={remove} disabled={context.structurallyLocked} className="text-destructive" />
            </>
          ) : null}
        </div>
        {noteOpen ? (
          <textarea
            ref={noteRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(note);
                setNoteOpen(false);
              }
            }}
            rows={3}
            placeholder={t("annotate.notePlaceholder")}
            aria-label={t("annotate.note")}
            className="field w-56 resize-none rounded-lg px-2 py-1.5 text-xs"
          />
        ) : null}
      </div>
    </div>
  );
}
