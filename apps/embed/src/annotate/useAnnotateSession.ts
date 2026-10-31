import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useRegistry } from "@embedpdf/core/preact";
import { uuidV4 } from "@embedpdf/models";
import { useAnnotation, useAnnotationCapability } from "@embedpdf/plugin-annotation/preact";
import { useExportCapability } from "@embedpdf/plugin-export/preact";
import { useHistoryCapability } from "@embedpdf/plugin-history/preact";
import { annotateError } from "../api/errors";
import type { VivePdfAnnotation, VivePdfAnnotationChangeDetail, VivePdfTool } from "../api/types";
import type { AnnotateApi } from "../viewer/bridge";
import { readAnnotationList, toPublic } from "./exchange";
import { ANNOTATION_COLORS, STROKE_WIDTHS, isAnnotateTool, toolDefaults, toolFromPublic, type AnnotateTool, type AnnotationColor, type StrokeWidth } from "./tools";

const HISTORY_TOPIC = "annotations";
const FLUSH_ATTEMPTS = 250;
const FLUSH_WAIT_MS = 20;

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
  api: AnnotateApi;
};

export function useAnnotateSession(documentId: string, onChange: (detail: VivePdfAnnotationChangeDetail) => void): AnnotateSession {
  const { documents } = useRegistry();
  const pdfDocument = documents[documentId]?.document ?? null;
  const { provides: annotations } = useAnnotationCapability();
  const { state, provides: scope } = useAnnotation(documentId);
  const { provides: history } = useHistoryCapability();
  const { provides: exporter } = useExportCapability();
  const [open, setOpenState] = useState(false);
  const [color, setColorState] = useState<AnnotationColor>(ANNOTATION_COLORS[0]);
  const [width, setWidthState] = useState<StrokeWidth>(STROKE_WIDTHS[1]);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [edited, setEdited] = useState(false);
  const quietRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
      if (event.documentId !== documentId || event.type === "loaded") return;
      setEdited(true);
      if (!quietRef.current && !event.committed) onChangeRef.current({ type: event.type, page: event.pageIndex + 1 });
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
    if (!scope || !exporter) throw annotateError("not-ready", "the document is still opening");
    let attempt = 0;
    for (; attempt < FLUSH_ATTEMPTS; attempt += 1) {
      await scope.commit().toPromise();
      if (!scope.getState().hasPendingChanges) break;
      await new Promise((resolve) => window.setTimeout(resolve, FLUSH_WAIT_MS));
    }
    if (attempt === FLUSH_ATTEMPTS) throw annotateError("failed", "the drawings could not be written into the PDF");
    const buffer = await exporter.forDocument(documentId).saveAsCopy().toPromise();
    return new Blob([buffer], { type: "application/pdf" });
  }, [scope, exporter, documentId]);

  const list = useCallback(
    (): VivePdfAnnotation[] =>
      Object.values(state.pages)
        .flat()
        .flatMap((uid) => {
          const tracked = state.byUid[uid];
          const entry = tracked && tracked.commitState !== "deleted" ? toPublic(tracked.object) : null;
          return entry ? [entry] : [];
        }),
    [state.pages, state.byUid],
  );

  const replace = useCallback(
    (input: unknown) => {
      if (!scope || !history || !pdfDocument) throw annotateError("not-ready", "the document is still opening");
      const created = readAnnotationList(input, pdfDocument.pages.map((page) => page.size), uuidV4);
      const replaced = Object.values(state.byUid).flatMap((tracked) => (tracked.commitState !== "deleted" && toPublic(tracked.object) ? [{ pageIndex: tracked.object.pageIndex, id: tracked.object.id }] : []));
      scope.deselectAnnotation();
      quietRef.current = true;
      try {
        if (replaced.length > 0) scope.deleteAnnotations(replaced);
      } finally {
        quietRef.current = false;
      }
      scope.importAnnotations(created.map((annotation) => ({ annotation })));
      history.forDocument(documentId).purgeByMetadata(() => true, HISTORY_TOPIC);
      setEdited(true);
    },
    [scope, history, pdfDocument, state.byUid, documentId],
  );

  const chooseTool = useCallback(
    (name: VivePdfTool | null) => {
      if (name === null) {
        setTool(null);
        return;
      }
      const next = toolFromPublic(name);
      if (!next) return;
      setOpenState(true);
      setTool(next);
    },
    [setTool],
  );

  const api = useMemo(() => ({ list, replace, save, chooseTool }), [list, replace, save, chooseTool]);

  const undo = useCallback(() => history?.forDocument(documentId).undo(HISTORY_TOPIC), [history, documentId]);
  const redo = useCallback(() => history?.forDocument(documentId).redo(HISTORY_TOPIC), [history, documentId]);

  return useMemo(
    () => ({ open, setOpen, tool, setTool, color, setColor, width, setWidth, canUndo: undoState.canUndo, canRedo: undoState.canRedo, undo, redo, selected: state.selectedUids.length, deleteSelected, edited, save, api }),
    [open, setOpen, tool, setTool, color, setColor, width, setWidth, undoState, undo, redo, state.selectedUids.length, deleteSelected, edited, save, api],
  );
}
