import { useEffect, useId, useMemo, useState } from "react";
import { Bold, BookMarked, Image as ImageIcon, Italic, Link2, Strikethrough, Subscript, Superscript, Trash2, Underline, Unlink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { IconButton } from "@/components/shared/IconButton";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { CITATION } from "./citationItems";
import { citationTerms, storeCitationSource } from "./citationSource";
import { pickDocumentImage } from "./documentFile";
import { LinkDialog } from "./DocumentToolbar";
import { noteContent, noteExtensions, noteValue } from "./footnoteEditor";
import { footnotePicture } from "./footnotePicture";
import { FOOTNOTE, MAX_FOOTNOTE_PICTURES } from "./footnotes";
import { SourcesDialog } from "./SourcesDialog";

type SelectedNote = { position: number; text: string; html: string; number: number };

function selectedNote(editor: Editor): SelectedNote | null {
  const { selection, doc } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== FOOTNOTE) return null;
  let number = 1;
  doc.nodesBetween(0, selection.from, (node, position) => {
    if (node.type.name === FOOTNOTE && position < selection.from) number += 1;
  });
  return { position: selection.from, text: String(selection.node.attrs.text ?? ""), html: String(selection.node.attrs.html ?? ""), number };
}

function NoteMarks({ note }: { note: Editor }) {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false);
  const [citing, setCiting] = useState(false);
  const state = useEditorState({
    editor: note,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      superscript: current.isActive("superscript"),
      subscript: current.isActive("subscript"),
      link: current.isActive("link"),
      citation: current.isActive(CITATION),
    }),
  });
  const chain = () => note.chain().focus();
  const insertPicture = async () => {
    let pictures = 0;
    note.state.doc.descendants((node) => {
      if (node.type.name === "image") pictures += 1;
    });
    if (pictures >= MAX_FOOTNOTE_PICTURES) {
      useToastStore.getState().push("info", t("studio.doc.footnotes.pictureLimit"));
      return;
    }
    try {
      const picked = await pickDocumentImage(t("studio.doc.footnotes.picture"));
      if (!picked) return;
      const src = await footnotePicture(picked.src);
      if (!src) {
        useToastStore.getState().push("error", t("studio.doc.footnotes.pictureTooLarge"));
        return;
      }
      chain().setImage({ src, alt: "" }).run();
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    }
  };
  return (
    <div role="toolbar" aria-label={t("studio.doc.toolbar.label")} className="flex flex-wrap items-center gap-0.5">
      <IconButton icon={Bold} label={t("studio.doc.toolbar.bold")} shortcut="Ctrl+B" active={state.bold} onClick={() => chain().toggleBold().run()} />
      <IconButton icon={Italic} label={t("studio.doc.toolbar.italic")} shortcut="Ctrl+I" active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <IconButton icon={Underline} label={t("studio.doc.toolbar.underline")} shortcut="Ctrl+U" active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <IconButton icon={Strikethrough} label={t("studio.doc.toolbar.strike")} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <IconButton icon={Superscript} label={t("studio.doc.toolbar.superscript")} active={state.superscript} onClick={() => chain().toggleSuperscript().run()} />
      <IconButton icon={Subscript} label={t("studio.doc.toolbar.subscript")} active={state.subscript} onClick={() => chain().toggleSubscript().run()} />
      <IconButton icon={Link2} label={t("studio.doc.toolbar.link")} active={state.link} onClick={() => setLinking(true)} />
      {state.link ? <IconButton icon={Unlink} label={t("studio.doc.toolbar.unlink")} onClick={() => chain().extendMarkRange("link").unsetLink().run()} /> : null}
      <IconButton icon={BookMarked} label={t("studio.doc.footnotes.cite")} active={state.citation} onClick={() => setCiting(true)} data-testid="footnote-cite" />
      <IconButton icon={ImageIcon} label={t("studio.doc.footnotes.picture")} onClick={() => void insertPicture()} data-testid="footnote-picture" />
      {linking ? <LinkDialog editor={note} open={linking} onClose={() => setLinking(false)} /> : null}
      {citing ? <SourcesDialog editor={note} open={citing} onClose={() => setCiting(false)} /> : null}
    </div>
  );
}

function NoteEditor({ editor, note }: { editor: Editor; note: SelectedNote }) {
  const hintId = useId();
  const { t, i18n } = useTranslation();
  const extensions = useMemo(() => noteExtensions(t("studio.doc.footnotes.placeholder"), storeCitationSource(citationTerms(t), i18n.language, t("studio.doc.cite.referencesDefault"), t("studio.doc.cite.emptyList"))), [t, i18n.language]);
  const noteEditor = useEditor({
    extensions,
    content: noteContent(note.text, note.html),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": t("studio.doc.footnotes.text"),
        "aria-multiline": "true",
        "aria-describedby": hintId,
        class: "field min-h-9 w-full rounded-lg px-2 py-1.5 text-sm",
      },
    },
    onUpdate: ({ editor: current }) => {
      const { text, html } = noteValue(current);
      editor.view.dispatch(editor.state.tr.setNodeAttribute(note.position, "text", text).setNodeAttribute(note.position, "html", html));
    },
  });
  const fresh = note.text === "";
  useEffect(() => {
    if (fresh) noteEditor?.view.focus();
  }, [noteEditor, fresh]);
  if (!noteEditor) return null;
  return (
    <>
      <NoteMarks note={noteEditor} />
      <EditorContent editor={noteEditor} />
      <p id={hintId} className="text-xs text-muted-foreground">
        {t("studio.doc.footnotes.hint")}
      </p>
    </>
  );
}

export function FootnotePanel({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const note = useEditorState({ editor, selector: ({ editor: current }) => selectedNote(current) });

  if (!note) return null;

  const backToText = () => {
    const after = Math.min(note.position + 1, editor.state.doc.content.size);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, after)));
    editor.commands.focus();
  };

  const remove = () => {
    editor.view.dispatch(editor.state.tr.delete(note.position, note.position + 1));
    editor.commands.focus();
  };

  return (
    <section
      aria-label={t("studio.doc.footnotes.panel", { number: note.number })}
      className="glass absolute inset-x-4 bottom-12 z-20 mx-auto max-w-xl space-y-2 rounded-xl border border-border/60 p-3 shadow-lg"
      data-testid="footnote-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.contains(event.target as HTMLElement)) return;
        event.preventDefault();
        backToText();
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-medium">{t("studio.doc.footnotes.panel", { number: note.number })}</h2>
        <IconButton icon={Trash2} label={t("studio.doc.footnotes.remove")} onClick={remove} />
        <IconButton icon={X} label={t("studio.doc.footnotes.done")} shortcut="Esc" onClick={backToText} />
      </div>
      <NoteEditor key={note.position} editor={editor} note={note} />
    </section>
  );
}
