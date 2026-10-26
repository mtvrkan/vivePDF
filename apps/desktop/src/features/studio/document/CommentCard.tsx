import { useState, type KeyboardEvent, type Ref } from "react";
import { Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { TextArea, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { commentTime, initials, MAX_COMMENT_AUTHOR, MAX_COMMENT_TEXT, type CommentEntry, type CommentThread } from "./comments";
import { useCommentsView } from "./commentsView";

type Composer = { label: string; submitLabel: string; initial?: string; autoFocus?: boolean; onSubmit: (text: string) => void; onCancel?: () => void; testId: string };

function submitKeys(event: KeyboardEvent<HTMLTextAreaElement>, submit: () => void, cancel?: () => void) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  } else if (event.key === "Escape" && cancel) {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
}

function CommentComposer({ label, submitLabel, initial = "", autoFocus = false, onSubmit, onCancel, testId }: Composer) {
  const { t } = useTranslation();
  const author = useCommentsView((state) => state.author);
  const setAuthor = useCommentsView((state) => state.setAuthor);
  const [name, setName] = useState("");
  const [text, setText] = useState(initial);
  const needsName = !author;
  const ready = text.trim().length > 0 && (!needsName || name.trim().length > 0);
  const submit = () => {
    if (!ready) return;
    if (needsName) setAuthor(name);
    onSubmit(text.trim());
    setText("");
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      {needsName ? (
        <TextInput
          value={name}
          maxLength={MAX_COMMENT_AUTHOR}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("studio.doc.comments.authorPlaceholder")}
          aria-label={t("studio.doc.comments.authorLabel")}
          className="h-8 text-sm"
          autoFocus={autoFocus}
        />
      ) : null}
      <TextArea
        value={text}
        rows={2}
        maxLength={MAX_COMMENT_TEXT}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => submitKeys(event, submit, onCancel)}
        placeholder={label}
        aria-label={label}
        className="resize-none text-sm"
        autoFocus={autoFocus && !needsName}
        data-testid={testId}
      />
      {text.trim() || onCancel ? (
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!ready} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Byline({ entry, locale }: { entry: CommentEntry; locale: string }) {
  const { t } = useTranslation();
  const name = entry.author || t("studio.doc.comments.anonymous");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground" aria-hidden>
        {initials(name)}
      </span>
      <span className="truncate font-semibold text-foreground">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{commentTime(entry.createdAt, locale)}</span>
    </div>
  );
}

export function DraftCard({ onPost, onCancel, ref }: { onPost: (text: string) => void; onCancel: () => void; ref?: Ref<HTMLElement> }) {
  const { t } = useTranslation();
  return (
    <article ref={ref} aria-label={t("studio.doc.comments.new")} className="vp-comment-card rounded-xl border border-primary/50 bg-card p-3 text-sm shadow-sm ring-3 ring-primary/15" data-testid="comment-draft">
      <CommentComposer label={t("studio.doc.comments.placeholder")} submitLabel={t("studio.doc.comments.post")} autoFocus onSubmit={onPost} onCancel={onCancel} testId="comment-draft-text" />
    </article>
  );
}

type CardProps = {
  thread: CommentThread;
  active: boolean;
  onActivate: () => void;
  onReply: (text: string) => void;
  onEdit: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onRemove: () => void;
  ref?: Ref<HTMLElement>;
};

export function CommentCard({ thread, active, onActivate, onReply, onEdit, onResolve, onRemove, ref }: CardProps) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const locale = i18n.language;
  const name = thread.author || t("studio.doc.comments.anonymous");
  return (
    <article
      ref={ref}
      aria-label={t("studio.doc.comments.cardLabel", { author: name })}
      aria-current={active || undefined}
      className={cn("vp-comment-card rounded-xl border bg-card p-3 text-sm shadow-sm transition-colors duration-(--transition-fast)", active ? "border-primary/50 ring-3 ring-primary/15" : "border-border", thread.resolved && !active && "opacity-60")}
      data-testid="comment-card"
      data-comment-card={thread.id}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Byline entry={thread} locale={locale} />
        </div>
        <IconButton
          icon={thread.resolved ? RotateCcw : Check}
          label={thread.resolved ? t("studio.doc.comments.reopen") : t("studio.doc.comments.resolve")}
          onClick={() => onResolve(!thread.resolved)}
          className="size-7"
          data-testid="comment-resolve"
        />
        {active ? (
          <>
            <IconButton icon={Pencil} label={t("studio.doc.comments.edit")} onClick={() => setEditing(true)} className="size-7" />
            <IconButton icon={Trash2} label={t("studio.doc.comments.remove")} onClick={onRemove} className="size-7" data-testid="comment-remove" />
          </>
        ) : null}
      </div>
      {editing ? (
        <CommentComposer
          label={t("studio.doc.comments.placeholder")}
          submitLabel={t("studio.doc.comments.save")}
          initial={thread.text}
          autoFocus
          onSubmit={(text) => {
            onEdit(text);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          testId="comment-edit-text"
        />
      ) : (
        <button type="button" onClick={onActivate} className="mt-1 block w-full whitespace-pre-wrap break-words rounded-md text-start text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {thread.text}
        </button>
      )}
      {thread.resolved ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-success">
          <Check className="size-3.5" aria-hidden />
          {t("studio.doc.comments.resolved")}
        </p>
      ) : null}
      {active
        ? thread.replies.map((reply) => (
            <div key={reply.id} className="mt-2 border-t border-border pt-2">
              <Byline entry={reply} locale={locale} />
              <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{reply.text}</p>
            </div>
          ))
        : thread.replies.length > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{t("studio.doc.comments.replies", { count: thread.replies.length })}</p>
          ) : null}
      {active && !editing ? <CommentComposer label={t("studio.doc.comments.reply")} submitLabel={t("studio.doc.comments.send")} onSubmit={onReply} testId="comment-reply-text" /> : null}
    </article>
  );
}
