import { useMemo, useRef, useState } from "react";
import { Check, Copy, Minus, Plus, WrapText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { useModalFocus } from "@/shared/hooks/useModalFocus";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useToastStore } from "@/shared/store/toastStore";
import { tokenizeLine, type Token } from "./highlight";

const FONT_MIN = 12;
const FONT_MAX = 28;
const FONT_STEP = 2;

function tokenClassName(kind: Token["kind"]): string {
  switch (kind) {
    case "keyword":
      return "text-primary";
    case "string":
      return "text-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-foreground))]";
    case "comment":
      return "text-muted-foreground italic";
    case "number":
      return "text-[color-mix(in_oklab,var(--tone,var(--color-primary))_60%,var(--color-foreground))]";
    default:
      return "text-foreground";
  }
}

export function CodeBlockOverlay({ pageIndex, blockId }: { pageIndex: number; blockId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const entry = usePresentationStore((state) => state.codeBlocksByPage[pageIndex]);
  const closeCodeBlock = usePresentationStore((state) => state.closeCodeBlock);
  const block = entry?.blocks.find((item) => item.id === blockId) ?? null;
  const [fontSize, setFontSize] = useState(18);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightRange, setHighlightRange] = useState<{ from: number; to: number } | null>(null);

  const tokenLines = useMemo(() => block?.lines.map((line) => tokenizeLine(line, block.language)) ?? [], [block]);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, block !== null, { initialFocus: "panel" });

  if (!block) return null;

  const onLineNumberClick = (index: number, shiftKey: boolean) => {
    setHighlightRange((current) => {
      if (shiftKey && current) return { from: Math.min(current.from, index), to: Math.max(current.to, index) };
      return { from: index, to: index };
    });
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("error", t("presentation.copyFailed"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onMouseDown={closeCodeBlock}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={block.language ?? t("presentation.codeGeneric")}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="glass-menu flex outline-none max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex h-11 items-center gap-1.5 border-b px-3">
          <span className="glass-chip flex h-6 items-center rounded-full px-2 font-mono text-[11px] text-primary">{block.language ?? t("presentation.codeGeneric")}</span>
          <span className="flex-1" />
          <IconButton icon={Minus} label={t("presentation.zoomOutCode")} onClick={() => setFontSize((size) => Math.max(FONT_MIN, size - FONT_STEP))} />
          <span className="w-10 text-center font-mono text-xs tabular-nums text-muted-foreground">{fontSize}px</span>
          <IconButton icon={Plus} label={t("presentation.zoomInCode")} onClick={() => setFontSize((size) => Math.min(FONT_MAX, size + FONT_STEP))} />
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <IconButton icon={WrapText} label={t("presentation.wrapCode")} active={wrap} onClick={() => setWrap((current) => !current)} />
          <IconButton icon={copied ? Check : Copy} label={t("presentation.copyCode")} onClick={() => void copyCode()} />
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <IconButton icon={X} label={t("common.close")} onClick={closeCodeBlock} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-background/60 p-4" style={{ fontFamily: "var(--font-mono, ui-monospace)" }}>
          <table className="w-full border-collapse" style={{ fontSize }}>
            <tbody>
              {block.lines.map((line, index) => (
                <tr key={index} className={cn(highlightRange && index >= highlightRange.from && index <= highlightRange.to && "bg-primary/12")}>
                  <td
                    role="button"
                    tabIndex={0}
                    onClick={(event) => onLineNumberClick(index, event.shiftKey)}
                    className="select-none pr-3 text-right align-top text-muted-foreground/70 hover:text-primary"
                    style={{ width: "3ch" }}
                  >
                    {index + 1}
                  </td>
                  <td className={cn("align-top", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                    {tokenLines[index]?.map((token, tokenIndex) => (
                      <span key={tokenIndex} className={tokenClassName(token.kind)}>
                        {token.text}
                      </span>
                    )) ?? line}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
