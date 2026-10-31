import { clamp } from "@embedpdf/core";
import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject, type PdfInkAnnoObject, type PdfInkListObject, type Position } from "@embedpdf/models";
import type { HandlerFactory } from "@embedpdf/plugin-annotation";
import { continuesDrawing, inkBounds, joinStrokes, type InkStyle, type InkTarget, type OpenDrawing } from "./inkSession";

export type InkEditor = {
  find: (id: string) => InkTarget | null;
  update: (pageIndex: number, id: string, patch: Pick<PdfInkAnnoObject, "inkList" | "rect">) => void;
};

export type InkJoiner = {
  bind: (editor: InkEditor | null) => void;
  end: () => void;
  place: (pageIndex: number, strokes: PdfInkListObject[], style: InkStyle, create: (id: string) => void) => void;
};

export function createInkJoiner(): InkJoiner {
  let editor: InkEditor | null = null;
  let open: OpenDrawing | null = null;
  return {
    bind(next) {
      editor = next;
    },
    end() {
      open = null;
    },
    place(pageIndex, strokes, style, create) {
      const target = open && editor ? editor.find(open.id) : null;
      if (editor && target && continuesDrawing(open, pageIndex, style, target)) {
        editor.update(pageIndex, open.id, joinStrokes(target.inkList, strokes, style.strokeWidth));
        return;
      }
      const id = uuidV4();
      create(id);
      open = { ...style, pageIndex, id };
    },
  };
}

const STRAIGHTENED_TOOL = "inkHighlighter";
const SNAP_ANGLE_DEG = 15;
const LINE_THRESHOLD = 0.15;
const MIN_LINE_LENGTH = 5;

function isLineLike(points: readonly Position[], threshold: number): boolean {
  if (points.length < 3) return true;
  const start = points[0];
  const end = points[points.length - 1];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < MIN_LINE_LENGTH) return false;
  const deviation = points.reduce((max, point) => Math.max(max, Math.abs((end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y)) / length), 0);
  return deviation / length < threshold;
}

export function straighten(points: Position[]): Position[] {
  if (points.length < 2 || !isLineLike(points, LINE_THRESHOLD)) return points;
  const start = points[0];
  const end = points[points.length - 1];
  const angle = Math.atan2(Math.abs(end.y - start.y), Math.abs(end.x - start.x)) * (180 / Math.PI);
  if (angle <= SNAP_ANGLE_DEG) {
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    return [
      { x: start.x, y },
      { x: end.x, y },
    ];
  }
  if (angle >= 90 - SNAP_ANGLE_DEG) {
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    return [
      { x, y: start.y },
      { x, y: end.y },
    ];
  }
  return points;
}

export function joiningInkHandler(joiner: InkJoiner): HandlerFactory<PdfAnnotationObject> {
  return {
    annotationType: PdfAnnotationSubtype.INK,
    create(context) {
      const { onCommit, onPreview, getTool, pageSize, pageIndex } = context;
      let stroke: Position[] | null = null;
      const toPage = (position: Position): Position => ({ x: clamp(position.x, 0, pageSize.width), y: clamp(position.y, 0, pageSize.height) });
      const style = () => {
        const defaults = getTool()?.defaults as Partial<PdfInkAnnoObject> | undefined;
        if (!defaults) return null;
        return { ...defaults, strokeWidth: defaults.strokeWidth ?? 1, strokeColor: defaults.strokeColor ?? defaults.color ?? "#000000", opacity: defaults.opacity ?? 1, flags: defaults.flags ?? ["print"] };
      };
      const preview = () => {
        const current = style();
        if (!stroke || !current) return;
        const inkList = [{ points: stroke }];
        const rect = inkBounds(inkList, current.strokeWidth);
        onPreview({ type: PdfAnnotationSubtype.INK, bounds: rect, data: { ...current, rect, inkList } });
      };
      return {
        onPointerDown: (position, event) => {
          stroke = [toPage(position)];
          preview();
          event.setPointerCapture?.();
        },
        onPointerMove: (position) => {
          if (!stroke) return;
          stroke.push(toPage(position));
          preview();
        },
        onPointerUp: (_, event) => {
          event.releasePointerCapture?.();
          const points = stroke;
          stroke = null;
          const tool = getTool();
          const current = style();
          if (points && points.length > 1 && tool && current) {
            const line = tool.id === STRAIGHTENED_TOOL ? straighten(points) : points;
            const inkList = [{ points: line }];
            joiner.place(pageIndex, inkList, { toolId: tool.id, strokeColor: current.strokeColor, strokeWidth: current.strokeWidth }, (id) =>
              onCommit({ ...current, type: PdfAnnotationSubtype.INK, inkList, rect: inkBounds(inkList, current.strokeWidth), pageIndex, id, created: new Date() }),
            );
          }
          onPreview(null);
        },
        onPointerCancel: (_, event) => {
          stroke = null;
          onPreview(null);
          event.releasePointerCapture?.();
        },
      };
    },
  };
}
