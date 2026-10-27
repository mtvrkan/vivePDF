import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
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

type Modality = { keyboard: boolean; trigger: HTMLElement | null };

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

export function TrackChangeCard({ editor, change, authors, language, modality }: { editor: Editor; change: TrackedChange; authors: string[]; language: string; modality?: RefObject<Modality> }) {
  const { t } = useTranslation();
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const opened = useRef<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const shown = style !== null;
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

  useEffect(() => {
    if (!shown || opened.current === change.id) return;
    opened.current = change.id;
    const opener = modality?.current;
    returnTo.current = opener?.trigger ?? null;
    if (opener?.keyboard) card.current?.focus();
  }, [shown, change.id, modality]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    const target = returnTo.current;
    editor.commands.setActiveChange(null);
    if (target?.isConnected && target !== editor.view.dom) target.focus();
    else editor.commands.focus();
  };

  if (!style) return null;
  const author = change.author || t("studio.doc.track.unknownAuthor");
  return createPortal(
    <div ref={card} tabIndex={-1} role="dialog" aria-label={t("studio.doc.track.cardLabel", { author })} onKeyDown={onKeyDown} className="fixed z-40 rounded-xl border border-border bg-card p-3 text-sm shadow-(--shadow-float) focus-visible:outline-2 focus-visible:outline-ring" style={style} data-testid="track-change-card">
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
  const modality = useRef<Modality>({ keyboard: false, trigger: null });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      modality.current = { keyboard: true, trigger: event.target instanceof HTMLElement ? event.target : null };
    };
    const pointer = () => {
      modality.current = { keyboard: false, trigger: null };
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  const change = active && view === "markup" ? changes.find((item) => item.id === active) : undefined;
  return change ? <TrackChangeCard key={change.id} editor={editor} change={change} authors={authors} language={language} modality={modality} /> : null;
}
