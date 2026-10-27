import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Eye, FilePenLine, ListChecks, MessageSquareOff, MessageSquarePlus, MessagesSquare, Trash2, UserPen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { Field, TextInput } from "@/components/tool/form";
import { useToastStore } from "@/shared/store/toastStore";
import { RibbonButton, RibbonGroup, RibbonRows, RibbonSmallButton } from "../ribbon/Ribbon";
import { useCommentState } from "./useComments";
import { MAX_COMMENT_AUTHOR } from "./comments";
import { useCommentsView } from "./commentsView";
import { setTracking, TRACK_VIEWS, useTrackChangesView } from "./trackChangesView";
import { useTrackChanges } from "./useTrackChanges";

function NameDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const author = useCommentsView((state) => state.author);
  const setAuthor = useCommentsView((state) => state.setAuthor);
  const [name, setName] = useState(author);
  const save = () => {
    setAuthor(name);
    onSaved?.();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("studio.doc.comments.authorTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} data-testid="comment-author-save">
            {t("studio.doc.comments.save")}
          </Button>
        </>
      }
    >
      <Field label={t("studio.doc.comments.authorLabel")} hint={t("studio.doc.comments.authorHint")}>
        <TextInput
          autoFocus
          value={name}
          maxLength={MAX_COMMENT_AUTHOR}
          placeholder={t("studio.doc.comments.authorPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          data-testid="comment-author"
        />
      </Field>
    </Dialog>
  );
}

export function AuthorNameHost({ editor }: { editor: Editor }) {
  const naming = useCommentsView((state) => state.naming);
  const setNaming = useCommentsView((state) => state.setNaming);
  if (!naming) return null;
  return (
    <NameDialog
      onClose={() => {
        setNaming(false);
        useTrackChangesView.getState().setPendingTrack(false);
      }}
      onSaved={() => {
        if (useTrackChangesView.getState().pendingTrack) setTracking(editor, true);
      }}
    />
  );
}

export function ReviewGroups({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const { threads, focus } = useCommentState(editor);
  const shown = useCommentsView((state) => state.shown);
  const setShown = useCommentsView((state) => state.setShown);
  const setNaming = useCommentsView((state) => state.setNaming);
  const resolvedCount = threads.filter((thread) => thread.resolved).length;
  const track = useTrackChanges(editor);
  const view = useTrackChangesView((state) => state.view);
  const setView = useTrackChangesView((state) => state.setView);
  const panel = useTrackChangesView((state) => state.panel);
  const setPanel = useTrackChangesView((state) => state.setPanel);
  const hiddenAuthors = useTrackChangesView((state) => state.hiddenAuthors);
  const shownAuthors = track.authors.filter((author) => !hiddenAuthors.includes(author));
  const shownChanges = track.changes.filter((change) => shownAuthors.includes(change.author));

  const start = () => {
    if (!editor.chain().focus().startComment().run()) {
      useToastStore.getState().push("info", t("studio.doc.comments.selectFirst"));
      return;
    }
    if (!shown) setShown(true);
  };
  const step = (direction: 1 | -1) => {
    if (threads.length === 0) return;
    const index = threads.findIndex((thread) => thread.id === focus.active);
    const next = index < 0 ? (direction > 0 ? 0 : threads.length - 1) : (index + direction + threads.length) % threads.length;
    if (!shown) setShown(true);
    editor.chain().focus().selectComment(threads[next].id).run();
  };
  const removeItems: ContextMenuItem[] = [
    { type: "item", id: "comment-remove-this", label: t("studio.doc.comments.removeThis"), disabled: !focus.active, onSelect: () => focus.active && editor.chain().focus().removeComment(focus.active).run() },
    { type: "item", id: "comment-remove-resolved", label: t("studio.doc.comments.removeResolved"), disabled: resolvedCount === 0, onSelect: () => editor.chain().focus().removeComments("resolved").run() },
    { type: "item", id: "comment-remove-all", label: t("studio.doc.comments.removeAll"), disabled: threads.length === 0, onSelect: () => editor.chain().focus().removeComments("all").run() },
  ];

  const stepChange = (direction: 1 | -1) => {
    const { changes } = track;
    if (changes.length === 0) return;
    const head = editor.state.selection.head;
    const index = changes.findIndex((change) => change.id === track.active);
    const nearest = direction > 0 ? changes.findIndex((change) => change.from > head) : changes.reduce((found, change, position) => (change.to < head ? position : found), -1);
    const next = index >= 0 ? (index + direction + changes.length) % changes.length : nearest >= 0 ? nearest : direction > 0 ? 0 : changes.length - 1;
    editor.chain().focus().selectChange(changes[next].id).run();
  };
  const viewItems: ContextMenuItem[] = TRACK_VIEWS.map((option) => ({ type: "item", id: `track-view-${option}`, label: t(`studio.doc.track.views.${option}`), checked: option === view, onSelect: () => setView(option) }));
  const settleItems = (accept: boolean): ContextMenuItem[] => [
    { type: "item", id: accept ? "track-accept-this" : "track-reject-this", label: t(accept ? "studio.doc.track.acceptThis" : "studio.doc.track.rejectThis"), disabled: !track.active, onSelect: () => track.active && editor.chain().focus()[accept ? "acceptChange" : "rejectChange"](track.active).run() },
    { type: "item", id: accept ? "track-accept-all" : "track-reject-all", label: t(accept ? "studio.doc.track.acceptAll" : "studio.doc.track.rejectAll"), disabled: shownChanges.length === 0, onSelect: () => editor.chain().focus()[accept ? "acceptAllChanges" : "rejectAllChanges"](shownAuthors).run() },
  ];

  return (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.tracking")}>
        <RibbonButton icon={FilePenLine} label={t("studio.doc.track.toggle")} active={track.tracking} onClick={() => setTracking(editor, !track.tracking)} testId="doc-track-toggle" />
        <RibbonButton icon={Eye} label={t(`studio.doc.track.views.${view}`)} menu={viewItems} testId="doc-track-view" />
        <RibbonButton icon={ListChecks} label={t("studio.doc.track.panel")} active={panel} onClick={() => setPanel(!panel)} testId="doc-track-panel" />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.changes")}>
        <RibbonButton icon={Check} label={t("studio.doc.track.accept")} menu={settleItems(true)} disabled={track.changes.length === 0} testId="doc-track-accept" />
        <RibbonButton icon={X} label={t("studio.doc.track.reject")} menu={settleItems(false)} disabled={track.changes.length === 0} testId="doc-track-reject" />
        <RibbonRows>
          <RibbonSmallButton icon={ArrowUp} label={t("studio.doc.track.previous")} disabled={track.changes.length === 0} onClick={() => stepChange(-1)} testId="doc-track-previous" />
          <RibbonSmallButton icon={ArrowDown} label={t("studio.doc.track.next")} disabled={track.changes.length === 0} onClick={() => stepChange(1)} testId="doc-track-next" />
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.comments")}>
        <RibbonButton icon={MessageSquarePlus} label={t("studio.doc.comments.new")} shortcut="Ctrl+Alt+M" onClick={start} testId="doc-comment-new" />
        <RibbonRows>
          <RibbonSmallButton icon={ChevronUp} label={t("studio.doc.comments.previous")} disabled={threads.length === 0} onClick={() => step(-1)} testId="doc-comment-previous" />
          <RibbonSmallButton icon={ChevronDown} label={t("studio.doc.comments.next")} disabled={threads.length === 0} onClick={() => step(1)} testId="doc-comment-next" />
        </RibbonRows>
        <RibbonButton icon={Trash2} label={t("studio.doc.comments.removeMenu")} menu={removeItems} disabled={threads.length === 0} testId="doc-comment-remove" />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.commentView")}>
        <RibbonButton icon={shown ? MessagesSquare : MessageSquareOff} label={t("studio.doc.comments.show")} active={shown} onClick={() => setShown(!shown)} testId="doc-comments-shown" />
        <RibbonButton icon={UserPen} label={t("studio.doc.comments.yourName")} onClick={() => setNaming(true)} testId="doc-comment-author" />
      </RibbonGroup>
    </>
  );
}
