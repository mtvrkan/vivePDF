import { useEffect, useRef, useState } from "react";
import { Paintbrush } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { IconButton } from "@/components/shared/IconButton";
import { applyFormat, captureFormat, type PaintedFormat } from "./formatPainter";

const PAINTING_CLASS = "vp-painting";

type Painter = { format: PaintedFormat; sticky: boolean };

export function FormatPainterButton({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [painter, setPainter] = useState<Painter | null>(null);
  const latest = useRef(painter);
  latest.current = painter;

  useEffect(() => {
    if (!painter) return;
    const dom = editor.view.dom;
    dom.classList.add(PAINTING_CLASS);
    const paint = () => {
      const current = latest.current;
      if (!current || editor.state.selection.empty) return;
      editor.view.dispatch(applyFormat(editor.state.tr, current.format));
      if (!current.sticky) setPainter(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPainter(null);
    };
    dom.addEventListener("mouseup", paint);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      dom.classList.remove(PAINTING_CLASS);
      dom.removeEventListener("mouseup", paint);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, painter]);

  return (
    <IconButton
      icon={Paintbrush}
      label={t("studio.doc.toolbar.painter")}
      title={t("studio.doc.toolbar.painterHint")}
      active={painter !== null}
      data-testid="doc-painter"
      onClick={() => setPainter((current) => (current ? null : { format: captureFormat(editor.state), sticky: false }))}
      onDoubleClick={() => setPainter({ format: captureFormat(editor.state), sticky: true })}
    />
  );
}
