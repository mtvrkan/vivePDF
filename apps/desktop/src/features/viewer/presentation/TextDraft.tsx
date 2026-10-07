import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { TEXT_FONT_WEIGHT, TEXT_LINE_HEIGHT, measureTextBlock } from "./strokes";

const CARET_ROOM_PX = 4;

export type TextDraftProps = {
  left: number;
  top: number;
  color: string;
  sizePx: number;
  opacity: number;
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
};

export function TextDraft({ left, top, color, sizePx, opacity, initial, onCommit, onCancel }: TextDraftProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const finished = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = t("presentation.textPlaceholder");

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    }
  };

  const block = measureTextBlock(text || placeholder, sizePx);

  return (
    <textarea
      ref={fieldRef}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={t("presentation.tools.text")}
      placeholder={placeholder}
      rows={Math.max(1, text.split("\n").length)}
      spellCheck={false}
      data-presentation-text-draft=""
      className="absolute z-30 resize-none overflow-hidden border-0 bg-transparent p-0 outline-dashed outline-1 outline-offset-4 outline-primary placeholder:text-muted-foreground"
      style={{
        left,
        top,
        width: block.width + CARET_ROOM_PX,
        height: block.height,
        color,
        opacity,
        fontSize: sizePx,
        lineHeight: TEXT_LINE_HEIGHT,
        fontWeight: TEXT_FONT_WEIGHT,
        fontFamily: "var(--font-sans)",
      }}
    />
  );
}
