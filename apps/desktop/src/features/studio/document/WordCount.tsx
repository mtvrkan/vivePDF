import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { countText, type TextCount } from "./formatPainter";

const SETTLE_MS = 250;

type Counts = { total: TextCount; selected: TextCount | null };

function measure(editor: Editor, language: string): Counts {
  const { doc, selection } = editor.state;
  const total = countText(doc, 0, doc.content.size, language);
  return { total, selected: selection.empty ? null : countText(doc, selection.from, selection.to, language) };
}

export function WordCount({ editor, language }: { editor: Editor; language: string }) {
  const { t, i18n } = useTranslation();
  const [counts, setCounts] = useState<Counts>(() => measure(editor, language));

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCounts(measure(editor, language)), SETTLE_MS);
    };
    schedule();
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    return () => {
      window.clearTimeout(timer);
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
    };
  }, [editor, language]);

  const number = new Intl.NumberFormat(i18n.language);
  const words = counts.selected ? t("studio.doc.count.selectedWords", { selected: number.format(counts.selected.words), total: number.format(counts.total.words) }) : t("studio.doc.count.words", { total: number.format(counts.total.words) });
  const characters = t("studio.doc.count.characters", { total: number.format((counts.selected ?? counts.total).characters) });

  return (
    <span className="tabular-nums" data-testid="document-count">
      {words} · {characters}
    </span>
  );
}
