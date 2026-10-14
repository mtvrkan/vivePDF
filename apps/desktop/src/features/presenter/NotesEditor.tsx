import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { MAX_NOTE_CHARS, readNotes, writeNotes, type PageNotes } from "./presenterNotes";

const NOTES_SAVE_DELAY_MS = 600;

type NotesLoad = "loading" | "ready" | "error";

type SaveState = "idle" | "saving" | "saved" | "error";

export function NotesEditor({ path, pageIndex, pageCount }: { path: string; pageIndex: number; pageCount: number }) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [load, setLoad] = useState<NotesLoad>("loading");
  const [attempt, setAttempt] = useState(0);
  const [notes, setNotes] = useState<PageNotes>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const notesRef = useRef<PageNotes>({});
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  const flush = useCallback((target: string) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const snapshot = notesRef.current;
    const count = pageCountRef.current;
    if (mounted.current) setSaveState("saving");
    chain.current = chain.current
      .then(() => writeNotes(target, snapshot, count))
      .then(
        () => {
          if (mounted.current && !dirty.current) setSaveState("saved");
        },
        () => {
          if (mounted.current) setSaveState("error");
        },
      );
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    setSaveState("idle");
    notesRef.current = {};
    setNotes({});
    readNotes(path).then(
      (loaded) => {
        if (cancelled) return;
        notesRef.current = loaded;
        setNotes(loaded);
        setLoad("ready");
      },
      () => {
        if (!cancelled) setLoad("error");
      },
    );
    return () => {
      cancelled = true;
      flush(path);
    };
  }, [path, attempt, flush]);

  const onChange = (text: string) => {
    const next = { ...notesRef.current };
    if (text.length > 0) next[pageIndex] = text.slice(0, MAX_NOTE_CHARS);
    else delete next[pageIndex];
    notesRef.current = next;
    setNotes(next);
    dirty.current = true;
    setSaveState("idle");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(path), NOTES_SAVE_DELAY_MS);
  };

  const text = notes[pageIndex] ?? "";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {t("presentation.presenter.notes")}
        </label>
        <span role="status" className="text-xs text-muted-foreground">
          {saveState === "saving" ? t("presentation.presenter.notesSaving") : saveState === "saved" ? t("presentation.presenter.notesSaved") : null}
        </span>
      </div>
      {load === "loading" ? (
        <div aria-busy className="animate-pulse space-y-2 rounded-lg border bg-card p-3" data-testid="notes-skeleton">
          <div className="h-3 w-full rounded-sm bg-muted" />
          <div className="h-3 w-4/5 rounded-sm bg-muted" />
          <div className="h-3 w-3/5 rounded-sm bg-muted" />
        </div>
      ) : null}
      {load === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-sm">
          <span className="text-destructive">{t("presentation.presenter.notesLoadError")}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((current) => current + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      {load === "ready" ? (
        <>
          <textarea
            id={fieldId}
            value={text}
            maxLength={MAX_NOTE_CHARS}
            placeholder={t("presentation.presenter.notesPlaceholder")}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => flush(path)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.currentTarget.blur();
            }}
            className="field min-h-0 flex-1 resize-none rounded-lg p-3 text-base leading-relaxed"
          />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span role={saveState === "error" ? "alert" : undefined} className="text-destructive">
              {saveState === "error" ? t("presentation.presenter.notesSaveError") : null}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">{t("presentation.presenter.notesCount", { count: text.length, max: MAX_NOTE_CHARS })}</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
