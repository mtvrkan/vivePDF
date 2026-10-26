import { useEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { currentPage, type PageLine } from "./pageBreaks";
import { indentsOf, PX_PER_PT, type Indents } from "./ruler";
import { SPACING_TYPES } from "./spacing";
import type { LaidOut } from "./useDocumentLayout";

export type RulerBlock = { left: number; width: number; indents: Indents };
export type RulerFrame = { scale: number; paperX: number; paperY: number; block: RulerBlock | null; page: number | null };

type Tracked = { laid?: LaidOut | null; lines?: PageLine[] | null; zoom?: number };

function caretBlock(editor: Editor): { element: HTMLElement; attributes: Record<string, unknown> } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!SPACING_TYPES.includes(node.type.name)) continue;
    const element = editor.view.nodeDOM($from.before(depth));
    return element instanceof HTMLElement ? { element, attributes: node.attrs } : null;
  }
  return null;
}

function measuredBlock(editor: Editor, origin: number, scale: number): RulerBlock | null {
  const found = caretBlock(editor);
  const container = found?.element.parentElement;
  if (!found || !container) return null;
  const rect = container.getBoundingClientRect();
  const style = getComputedStyle(container);
  const cssToScreen = scale / PX_PER_PT;
  const inset = (side: "Left" | "Right") => ((parseFloat(style[`padding${side}`]) || 0) + (parseFloat(style[`border${side}Width`]) || 0)) * cssToScreen;
  const left = rect.left + inset("Left");
  const width = rect.right - inset("Right") - left;
  return width > 0 ? { left: left - origin, width, indents: indentsOf(found.attributes) } : null;
}

function same(a: RulerFrame | null, b: RulerFrame | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useRulerFrame(editor: Editor, paper: RefObject<HTMLElement | null>, host: RefObject<HTMLElement | null>, own: RefObject<HTMLElement | null>, widthPt: number, tracked: Tracked = {}): RulerFrame | null {
  const [frame, setFrame] = useState<RulerFrame | null>(null);
  const { laid = null, lines = null, zoom = 1 } = tracked;

  useEffect(() => {
    let request = 0;
    let watchingBody = false;
    const measure = () => {
      request = 0;
      const sheet = paper.current;
      const band = own.current;
      if (!sheet || !band || editor.isDestroyed || !editor.isInitialized) {
        if (!editor.isDestroyed) request = requestAnimationFrame(measure);
        return;
      }
      if (!watchingBody) {
        watchingBody = true;
        observer?.observe(editor.view.dom);
      }
      const sheetRect = sheet.getBoundingClientRect();
      const bandRect = band.getBoundingClientRect();
      const scale = sheetRect.width / widthPt;
      if (!(scale > 0)) return;
      const next: RulerFrame = {
        scale,
        paperX: sheetRect.left - bandRect.left,
        paperY: sheetRect.top - bandRect.top,
        block: measuredBlock(editor, bandRect.left, scale),
        page: lines ? currentPage(editor, laid, lines, sheet, zoom) : null,
      };
      setFrame((current) => (same(current, next) ? current : next));
    };
    const schedule = () => {
      if (!request) request = requestAnimationFrame(measure);
    };
    schedule();
    const scroller = host.current;
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editor.on("transaction", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (const element of [paper.current, scroller, own.current]) if (element) observer?.observe(element);
    return () => {
      if (request) cancelAnimationFrame(request);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editor.off("transaction", schedule);
      observer?.disconnect();
    };
  }, [editor, paper, host, own, widthPt, laid, lines, zoom]);

  return frame;
}
