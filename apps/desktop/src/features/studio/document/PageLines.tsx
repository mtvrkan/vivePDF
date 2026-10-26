import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { pageBreaks, wordsPosition, type PageLine } from "./pageBreaks";
import type { LaidOut } from "./useDocumentLayout";

const LINE_LIFT = 3;

function blockStart(editor: Editor, index: number): number {
  let start = 0;
  for (let child = 0; child < index; child += 1) start += editor.state.doc.child(child).nodeSize;
  return start;
}

function blockElement(editor: Editor, index: number): HTMLElement | null {
  if (index < 0 || index >= editor.state.doc.childCount) return null;
  const node = editor.view.nodeDOM(blockStart(editor, index));
  return node instanceof HTMLElement ? node : null;
}

function measure(editor: Editor, laid: LaidOut, paper: HTMLElement, zoom: number): PageLine[] {
  const origin = paper.getBoundingClientRect().top;
  const local = (top: number) => (top - origin) / zoom;
  const lines: PageLine[] = [];
  for (const pageBreak of pageBreaks(laid)) {
    if (pageBreak.words === null) {
      const element = blockElement(editor, pageBreak.block);
      if (!element) continue;
      const previous = blockElement(editor, pageBreak.block - 1);
      const top = local(element.getBoundingClientRect().top);
      lines.push({ page: pageBreak.page, y: previous ? (local(previous.getBoundingClientRect().bottom) + top) / 2 : top - LINE_LIFT });
      continue;
    }
    const position = wordsPosition(editor.state.doc, pageBreak.block, pageBreak.words);
    if (position === null) continue;
    lines.push({ page: pageBreak.page, y: local(editor.view.coordsAtPos(position).top) - LINE_LIFT });
  }
  return lines;
}

export function PageLines({ editor, laid, paper, zoom, onLines }: { editor: Editor; laid: LaidOut | null; paper: RefObject<HTMLDivElement | null>; zoom: number; onLines: (lines: PageLine[]) => void }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<PageLine[]>([]);

  const update = useCallback(() => {
    const node = paper.current;
    const next = laid && node && !editor.isDestroyed ? measure(editor, laid, node, zoom) : [];
    setLines(next);
    onLines(next);
  }, [editor, laid, paper, zoom, onLines]);

  useLayoutEffect(update, [update]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    editor.on("update", schedule);
    const node = paper.current;
    const observer = node ? new ResizeObserver(schedule) : null;
    if (node) observer?.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", schedule);
      observer?.disconnect();
    };
  }, [editor, paper, update]);

  return (
    <>
      {lines.map((line) => (
        <div key={line.page} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/60" style={{ top: line.y }} aria-hidden data-page-line={line.page}>
          <span className="absolute -top-2.5 end-2 rounded-full border border-border bg-card px-2 text-2xs font-semibold leading-4 text-muted-foreground">{t("studio.doc.pageLines.label", { page: line.page })}</span>
        </div>
      ))}
    </>
  );
}
