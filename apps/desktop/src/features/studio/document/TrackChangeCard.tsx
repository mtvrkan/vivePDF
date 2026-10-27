import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { commentTime, initials } from "./comments";
import { authorTone, snippet, TONE_COLOURS, type TrackedChange } from "./trackChanges";
import { useTrackChangesView } from "./trackChangesView";
import { useTrackChanges } from "./useTrackChanges";

const CARD_WIDTH = 272;
const EDGE = 8;
const GAP = 6;

export function ChangeAvatar({ author, authors, size = "md" }: { author: string; authors: string[]; size?: "sm" | "md" }) {
  return (
    <span aria-hidden className={size === "sm" ? "grid size-4 shrink-0 place-items-center rounded-full text-3xs font-semibold text-white" : "grid size-6 shrink-0 place-items-center rounded-full text-2xs font-semibold text-white"} style={{ background: TONE_COLOURS[authorTone(authors, author)] }}>
      {initials(author)}
    </span>
  );
}

export function ChangeSummary({ change }: { change: TrackedChange }) {
  const { t } = useTranslation();
  if (change.kind === "replace")
    return (
      <>
        {t("studio.doc.track.replaced")}: <s className="text-destructive">{snippet(change.deleted, 40) || "…"}</s> → <span className="text-foreground">{snippet(change.inserted, 40) || "…"}</span>
      </>
    );
  if (change.kind === "delete")
    return (
      <>
        {t("studio.doc.track.deleted")}: <s className="text-destructive">{snippet(change.deleted) || "…"}</s>
      </>
    );
  return (
    <>
      {t("studio.doc.track.inserted")}: <span className="text-foreground">“{snippet(change.inserted) || "…"}”</span>
    </>
  );
}

function anchorOf(editor: Editor, id: string): DOMRect | null {
  const element = editor.view.dom.querySelector(`[data-change-id="${CSS.escape(id)}"]`);
  return element?.getClientRects()[0] ?? null;
}

export function TrackChangeCard({ editor, change, authors, language }: { editor: Editor; change: TrackedChange; authors: string[]; language: string }) {
  const { t } = useTranslation();
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const place = useCallback(() => {
    const rect = anchorOf(editor, change.id);
    if (!rect) {
      setStyle(null);
      return;
    }
    const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - CARD_WIDTH - EDGE);
    setStyle({ left, top: rect.bottom + GAP, width: CARD_WIDTH });
  }, [editor, change.id]);

  useLayoutEffect(place, [place, change.from, change.to]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [place]);

  if (!style) return null;
  const author = change.author || t("studio.doc.track.unknownAuthor");
  return createPortal(
    <div role="dialog" aria-label={t("studio.doc.track.cardLabel", { author })} className="fixed z-40 rounded-xl border border-border bg-card p-3 text-sm shadow-(--shadow-float)" style={style} data-testid="track-change-card">
      <div className="flex items-center gap-2">
        <ChangeAvatar author={change.author} authors={authors} />
        <span className="min-w-0 flex-1 truncate font-medium">{author}</span>
        <time className="shrink-0 font-mono text-2xs text-muted-foreground" dateTime={change.date || undefined}>
          {commentTime(change.date, language)}
        </time>
      </div>
      <p className="mt-2 break-words text-muted-foreground">
        <ChangeSummary change={change} />
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" icon={<Check className="size-3.5 text-success" aria-hidden />} onClick={() => editor.chain().focus().acceptChange(change.id).run()} data-testid="track-card-accept">
          {t("studio.doc.track.accept")}
        </Button>
        <Button size="sm" variant="secondary" icon={<X className="size-3.5 text-destructive" aria-hidden />} onClick={() => editor.chain().focus().rejectChange(change.id).run()} data-testid="track-card-reject">
          {t("studio.doc.track.reject")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

export function ActiveChangeCard({ editor, language }: { editor: Editor; language: string }) {
  const { changes, authors, active } = useTrackChanges(editor);
  const view = useTrackChangesView((state) => state.view);
  const change = active && view === "markup" ? changes.find((item) => item.id === active) : undefined;
  return change ? <TrackChangeCard editor={editor} change={change} authors={authors} language={language} /> : null;
}
