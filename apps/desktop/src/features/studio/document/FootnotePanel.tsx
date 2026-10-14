import { useEffect, useRef } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { IconButton } from "@/components/shared/IconButton";
import { TextArea } from "@/components/tool/form";
import { FOOTNOTE, MAX_FOOTNOTE } from "./footnotes";

type SelectedNote = { position: number; text: string; number: number };

function selectedNote(editor: Editor): SelectedNote | null {
  const { selection, doc } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== FOOTNOTE) return null;
  let number = 1;
  doc.nodesBetween(0, selection.from, (node, position) => {
    if (node.type.name === FOOTNOTE && position < selection.from) number += 1;
  });
  return { position: selection.from, text: String(selection.node.attrs.text ?? ""), number };
}

export function FootnotePanel({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const note = useEditorState({ editor, selector: ({ editor: current }) => selectedNote(current) });
  const field = useRef<HTMLTextAreaElement>(null);
  const position = note?.position ?? null;
  const fresh = note !== null && note.text === "";

  useEffect(() => {
    if (position !== null && fresh) field.current?.focus();
  }, [position, fresh]);

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
        if (event.key !== "Escape") return;
        event.preventDefault();
        backToText();
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-medium">{t("studio.doc.footnotes.panel", { number: note.number })}</h2>
        <IconButton icon={Trash2} label={t("studio.doc.footnotes.remove")} onClick={remove} />
        <IconButton icon={X} label={t("studio.doc.footnotes.done")} shortcut="Esc" onClick={backToText} />
      </div>
      <TextArea
        ref={field}
        value={note.text}
        rows={3}
        maxLength={MAX_FOOTNOTE}
        aria-label={t("studio.doc.footnotes.text")}
        placeholder={t("studio.doc.footnotes.placeholder")}
        onChange={(event) => editor.view.dispatch(editor.state.tr.setNodeAttribute(note.position, "text", event.target.value.replace(/\s*\n\s*/g, " ")))}
        className="w-full resize-none text-sm"
      />
    </section>
  );
}
