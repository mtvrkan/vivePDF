import { Check, CheckCheck, FilePenLine, Minus, Plus, Replace, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { Segmented } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { commentTime } from "./comments";
import { snippet, type TrackedChange } from "./trackChanges";
import { TRACK_VIEWS, useTrackChangesView } from "./trackChangesView";
import { ChangeAvatar } from "./TrackChangeCard";
import { useTrackChanges } from "./useTrackChanges";

const KIND_ICONS = { insert: Plus, delete: Minus, replace: Replace } as const;
const KIND_TONES = { insert: "bg-success/15 text-success", delete: "bg-destructive/10 text-destructive", replace: "bg-muted text-muted-foreground" } as const;

function ChangeText({ change }: { change: TrackedChange }) {
  if (change.kind === "replace")
    return (
      <>
        <s className="text-destructive">{snippet(change.deleted, 30) || "…"}</s> → <span className="font-medium">{snippet(change.inserted, 30) || "…"}</span>
      </>
    );
  if (change.kind === "delete") return <s className="text-destructive">{snippet(change.deleted, 60) || "…"}</s>;
  return <span className="font-medium">{snippet(change.inserted, 60) || "…"}</span>;
}

export function ChangesPanel({ editor, language, onTrack }: { editor: Editor; language: string; onTrack: () => void }) {
  const { t } = useTranslation();
  const { tracking, changes, authors, active } = useTrackChanges(editor);
  const view = useTrackChangesView((state) => state.view);
  const setView = useTrackChangesView((state) => state.setView);
  const setPanel = useTrackChangesView((state) => state.setPanel);
  const hidden = useTrackChangesView((state) => state.hiddenAuthors);
  const toggleAuthor = useTrackChangesView((state) => state.toggleAuthor);
  const shownAuthors = authors.filter((author) => !hidden.includes(author));
  const shown = changes.filter((change) => shownAuthors.includes(change.author));
  const nameOf = (author: string) => author || t("studio.doc.track.unknownAuthor");

  return (
    <aside aria-label={t("studio.doc.track.title")} className="flex w-80 shrink-0 flex-col border-s border-border bg-background" data-testid="changes-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border ps-3 pe-1">
        <h2 className="flex-1 truncate text-sm font-medium">{t("studio.doc.track.title")}</h2>
        {changes.length > 0 ? <span className="font-mono text-xs text-muted-foreground tabular-nums">{t("studio.doc.track.pending", { count: changes.length })}</span> : null}
        <IconButton icon={X} label={t("studio.doc.track.closePanel")} onClick={() => setPanel(false)} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <Segmented value={view} options={TRACK_VIEWS} labelOf={(option) => t(`studio.doc.track.views.${option}`)} onChange={setView} ariaLabel={t("studio.doc.track.view")} size="sm" className="w-full justify-between [&>button]:whitespace-nowrap [&>button]:px-2.5 [&>button]:text-xs" />
        {authors.length > 0 ? (
          <div role="group" aria-label={t("studio.doc.track.authorFilter")} className="flex flex-wrap gap-1.5">
            {authors.map((author) => {
              const count = changes.filter((change) => change.author === author).length;
              const on = !hidden.includes(author);
              return (
                <button
                  key={author}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAuthor(author)}
                  className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-muted ps-1 pe-2 text-xs transition-opacity duration-(--transition-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", !on && "opacity-50")}
                  data-testid="changes-author"
                >
                  <ChangeAvatar author={author} authors={authors} size="sm" />
                  <span className="truncate">{nameOf(author)}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {changes.length === 0 ? (
        <EmptyState
          icon={FilePenLine}
          title={t("studio.doc.track.emptyTitle")}
          description={t(tracking ? "studio.doc.track.emptyOn" : "studio.doc.track.emptyOff")}
          action={
            tracking ? undefined : (
              <Button size="sm" onClick={onTrack} data-testid="changes-turn-on">
                {t("studio.doc.track.turnOn")}
              </Button>
            )
          }
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="changes-list">
          {shown.map((change) => {
            const Icon = KIND_ICONS[change.kind];
            return (
              <li key={change.id} className={cn("flex items-start gap-2.5 border-b border-border px-3 py-2.5", change.id === active && "bg-primary/10")} data-testid="changes-item">
                <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md", KIND_TONES[change.kind])}>
                  <Icon className="size-3" />
                </span>
                <button type="button" onClick={() => editor.chain().focus().selectChange(change.id).run()} className="min-w-0 flex-1 rounded-md text-start text-sm leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span className="block break-words">
                    <ChangeText change={change} />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[nameOf(change.author), commentTime(change.date, language)].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <IconButton icon={Check} label={t("studio.doc.track.acceptThis")} onClick={() => editor.chain().focus().acceptChange(change.id).run()} className="size-7 shrink-0 text-success" data-testid="changes-accept" />
                <IconButton icon={X} label={t("studio.doc.track.rejectThis")} onClick={() => editor.chain().focus().rejectChange(change.id).run()} className="size-7 shrink-0 text-destructive" data-testid="changes-reject" />
              </li>
            );
          })}
        </ul>
      )}
      {changes.length > 0 ? (
        <div className="flex shrink-0 gap-2 border-t border-border p-3">
          <Button size="sm" variant="secondary" className="flex-1" icon={<CheckCheck className="size-3.5 text-success" aria-hidden />} disabled={shown.length === 0} onClick={() => editor.chain().focus().acceptAllChanges(shownAuthors).run()} data-testid="changes-accept-all">
            {t("studio.doc.track.acceptAllShort")}
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" icon={<X className="size-3.5 text-destructive" aria-hidden />} disabled={shown.length === 0} onClick={() => editor.chain().focus().rejectAllChanges(shownAuthors).run()} data-testid="changes-reject-all">
            {t("studio.doc.track.rejectAllShort")}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
