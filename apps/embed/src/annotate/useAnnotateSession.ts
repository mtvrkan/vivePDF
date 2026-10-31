import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useAnnotation, useAnnotationCapability } from "@embedpdf/plugin-annotation/preact";
import { useExportCapability } from "@embedpdf/plugin-export/preact";
import { useHistoryCapability } from "@embedpdf/plugin-history/preact";
import { ANNOTATION_COLORS, STROKE_WIDTHS, isAnnotateTool, toolDefaults, type AnnotateTool, type AnnotationColor, type StrokeWidth } from "./tools";

const HISTORY_TOPIC = "annotations";

export type AnnotateSession = {
  open: boolean;
  setOpen: (open: boolean) => void;
  tool: AnnotateTool | null;
  setTool: (tool: AnnotateTool | null) => void;
  color: AnnotationColor;
  setColor: (color: AnnotationColor) => void;
  width: StrokeWidth;
  setWidth: (width: StrokeWidth) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  selected: number;
  deleteSelected: () => void;
  edited: boolean;
  save: () => Promise<Blob>;
};

export function useAnnotateSession(documentId: string): AnnotateSession {
  const { provides: annotations } = useAnnotationCapability();
  const { state, provides: scope } = useAnnotation(documentId);
  const { provides: history } = useHistoryCapability();
  const { provides: exporter } = useExportCapability();
  const [open, setOpenState] = useState(false);
  const [color, setColorState] = useState<AnnotationColor>(ANNOTATION_COLORS[0]);
  const [width, setWidthState] = useState<StrokeWidth>(STROKE_WIDTHS[1]);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [edited, setEdited] = useState(false);
  const activeId = state.activeToolId;
  const tool = isAnnotateTool(activeId) ? activeId : null;

  useEffect(() => {
    if (!history) return;
    const scopeHistory = history.forDocument(documentId);
    const update = () => setUndoState({ canUndo: scopeHistory.canUndo(HISTORY_TOPIC), canRedo: scopeHistory.canRedo(HISTORY_TOPIC) });
    update();
    return scopeHistory.onHistoryChange(update);
  }, [history, documentId]);

  useEffect(() => {
    if (!annotations) return;
    return annotations.onAnnotationEvent((event) => {
      if (event.documentId === documentId && event.type !== "loaded") setEdited(true);
    });
  }, [annotations, documentId]);

  const apply = useCallback(
    (next: AnnotateTool | null, nextColor: AnnotationColor, nextWidth: StrokeWidth) => {
      if (!annotations || !scope) return;
      if (next) annotations.setToolDefaults(next, toolDefaults(next, nextColor, nextWidth));
      scope.setActiveTool(next);
    },
    [annotations, scope],
  );

  const setTool = useCallback((next: AnnotateTool | null) => apply(next, color, width), [apply, color, width]);

  const restyleSelection = useCallback(
    (nextColor: AnnotationColor, nextWidth: StrokeWidth) => {
      if (!scope) return;
      const patches = scope.getSelectedAnnotations().flatMap((item) => {
        const owner = annotations?.findToolForAnnotation(item.object)?.id;
        return isAnnotateTool(owner) ? [{ pageIndex: item.object.pageIndex, id: item.object.id, patch: toolDefaults(owner, nextColor, nextWidth) }] : [];
      });
      if (patches.length > 0) scope.updateAnnotations(patches);
    },
    [annotations, scope],
  );

  const setColor = useCallback(
    (next: AnnotationColor) => {
      setColorState(next);
      if (tool) apply(tool, next, width);
      restyleSelection(next, width);
    },
    [apply, restyleSelection, tool, width],
  );

  const setWidth = useCallback(
    (next: StrokeWidth) => {
      setWidthState(next);
      if (tool) apply(tool, color, next);
      restyleSelection(color, next);
    },
    [apply, restyleSelection, tool, color],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) {
        scope?.setActiveTool(null);
        scope?.deselectAnnotation();
      }
    },
    [scope],
  );

  const deleteSelected = useCallback(() => {
    if (!scope) return;
    const chosen = scope.getSelectedAnnotations().map((item) => ({ pageIndex: item.object.pageIndex, id: item.object.id }));
    if (chosen.length > 0) scope.deleteAnnotations(chosen);
  }, [scope]);

  const save = useCallback(async () => {
    if (!scope || !exporter) throw new Error("annotate-unavailable");
    await scope.commit().toPromise();
    const buffer = await exporter.forDocument(documentId).saveAsCopy().toPromise();
    return new Blob([buffer], { type: "application/pdf" });
  }, [scope, exporter, documentId]);

  const undo = useCallback(() => history?.forDocument(documentId).undo(HISTORY_TOPIC), [history, documentId]);
  const redo = useCallback(() => history?.forDocument(documentId).redo(HISTORY_TOPIC), [history, documentId]);

  return useMemo(
    () => ({ open, setOpen, tool, setTool, color, setColor, width, setWidth, canUndo: undoState.canUndo, canRedo: undoState.canRedo, undo, redo, selected: state.selectedUids.length, deleteSelected, edited, save }),
    [open, setOpen, tool, setTool, color, setColor, width, setWidth, undoState, undo, redo, state.selectedUids.length, deleteSelected, edited, save],
  );
}
