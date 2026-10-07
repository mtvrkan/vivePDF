import { Fragment, useEffect, useRef, useState } from "react";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import {
  ArrowRight,
  Baseline,
  BrushCleaning,
  Circle,
  Eraser,
  Highlighter,
  MousePointer2,
  PenLine,
  Redo2,
  Save,
  SaveAll,
  ScanEye,
  Square,
  SquareDashedMousePointer,
  Strikethrough,
  TextCursorInput,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useAnnotation, useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import { useExport } from "@embedpdf/plugin-export/react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { useDocumentSave } from "./useDocumentSave";
import { useRedaction } from "@embedpdf/plugin-redaction/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { PdfAnnotationSubtype, type LineEndings, type PdfLineAnnoObject, type PdfPolylineAnnoObject, type Rect } from "@embedpdf/models";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { cn } from "@/shared/lib/cn";
import { suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError } from "@/shared/rpc/client";
import { useDocumentStore } from "@/shared/store/documentStore";
import { outsideRender } from "@/shared/lib/outsideRender";
import { useToastStore } from "@/shared/store/toastStore";
import type { LucideIcon } from "lucide-react";
import { describeError } from "@/shared/lib/errorMessage";
import { DASH_TOOLS, DEFAULT_LINE_ENDINGS, FALLBACK_COLORS, FILL_TOOLS, LINE_ENDING_LABEL_KEYS, LINE_ENDING_OPTIONS, LINE_TOOLS, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH, STROKE_TOOLS, STROKE_WIDTH_STEP, SUBTYPE_TOOLS, stylePatchFor, toolColorFrom, type StyleValues } from "./annotateStyle";
import { CURVE_STEP, MAX_CURVE, MIN_CURVE, currentCurve, curveRectPatch, curvedVertices, isCurvable, lineEndpoints, polylineFromLine } from "./lineCurve";
import { styleValuesOf } from "./selectedStyle";
import { hasSelectionRects } from "./selectionMarkup";
import { markupSelection } from "./markupSelection";
import { ENGINE_TEXT_PLACEHOLDER, droppedUntouchedTexts } from "./untouchedText";
import { MAX_ERASER_SIZE, MIN_ERASER_SIZE, allMarks, useMarkToolMode, useMarkToolStore } from "./markArea";

type Tool = { id: string; icon: LucideIcon; labelKey: string };

const UNTOUCHED_TEXT_DELAY_MS = 300;

type LineLikeAnnotation = PdfLineAnnoObject | PdfPolylineAnnoObject;

function asLineLike(object: { type: PdfAnnotationSubtype } | null | undefined): LineLikeAnnotation | null {
  if (!object) return null;
  if (object.type === PdfAnnotationSubtype.LINE || object.type === PdfAnnotationSubtype.POLYLINE) return object as LineLikeAnnotation;
  return null;
}

const TOOLS: Tool[] = [
  { id: "highlight", icon: Highlighter, labelKey: "annotate.highlight" },
  { id: "underline", icon: Underline, labelKey: "annotate.underline" },
  { id: "strikeout", icon: Strikethrough, labelKey: "annotate.strikeout" },
  { id: "ink", icon: PenLine, labelKey: "annotate.ink" },
  { id: "square", icon: Square, labelKey: "annotate.square" },
  { id: "circle", icon: Circle, labelKey: "annotate.circle" },
  { id: "line", icon: Baseline, labelKey: "annotate.line" },
  { id: "lineArrow", icon: ArrowRight, labelKey: "annotate.arrow" },
  { id: "freeText", icon: TextCursorInput, labelKey: "annotate.freeText" },
];

export function AnnotateBar({ documentId, onClose, layout = "bar" }: { documentId: string; onClose?: () => void; layout?: "bar" | "dock" }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId]);
  const { provides: annotation, state: annotationState } = useAnnotation(documentId);
  const { provides: annotationCapability } = useAnnotationCapability();
  const { provides: redaction, state: redactionState } = useRedaction(documentId);
  const { provides: selection } = useSelectionCapability();
  const { provides: historyCapability } = useHistoryCapability();
  const { save: saveDocument } = useDocumentSave(documentId);
  const { provides: exporter } = useExport(documentId);
  const [saving, setSaving] = useState(false);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const markMode = useMarkToolMode(documentId);
  const areaActive = markMode === "area";
  const eraseActive = markMode === "erase";
  const eraserSize = useMarkToolStore((state) => state.eraserSize);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [color, setColor] = useState(FALLBACK_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [opacity, setOpacity] = useState(1);
  const [fill, setFill] = useState<string | null>(null);
  const [dashed, setDashed] = useState(false);
  const [toolEndings, setToolEndings] = useState<Record<string, LineEndings>>(DEFAULT_LINE_ENDINGS);
  const history = historyCapability?.forDocument(documentId) ?? null;

  useEffect(() => {
    const scope = historyCapability?.forDocument(documentId);
    if (!scope) return;
    const refresh = () => setHistoryState({ canUndo: scope.canUndo(), canRedo: scope.canRedo() });
    refresh();
    const unsubscribe = scope.onHistoryChange(() => outsideRender(refresh));
    return () => {
      unsubscribe();
    };
  }, [historyCapability, documentId]);

  const activeTool = annotationState.activeToolId ?? null;
  const redactActive = redaction?.isRedactActive() ?? false;
  const pendingCount = redactionState.pendingCount ?? 0;
  const selectedMarks = annotation?.getSelectedAnnotations() ?? [];
  const selected = annotation?.getSelectedAnnotation() ?? selectedMarks[0] ?? null;
  const markCount = allMarks(annotationState.byUid ?? {}).length;
  const presets: string[] = annotationCapability?.getColorPresets() ?? FALLBACK_COLORS;
  const swatches = presets.slice(0, 8);
  const colorRoving = useRovingRadios(swatches, Math.max(0, swatches.findIndex((preset) => preset.toLowerCase() === color.toLowerCase())), (preset) => applyStyle({ color: preset }), 2);
  const styleTarget = activeTool ?? (selected ? "selected" : null);
  const selectedTool = selected ? (SUBTYPE_TOOLS[selected.object.type] ?? null) : null;
  const styleTool = activeTool ?? selectedTool;
  const showStroke = styleTool ? STROKE_TOOLS.has(styleTool) : selected !== null;
  const showFill = styleTool !== null && FILL_TOOLS.has(styleTool);
  const showDash = styleTool !== null && DASH_TOOLS.has(styleTool);
  const showEndings = styleTool !== null && LINE_TOOLS.has(styleTool);
  const selectedLine = selectedMarks.length > 1 ? null : asLineLike(selected?.object);
  const endings = selectedLine?.lineEndings ?? toolEndings[styleTool ?? ""] ?? DEFAULT_LINE_ENDINGS.lineArrow;
  const curvableLine = selectedLine && isCurvable(selectedLine) ? selectedLine : null;
  const curve = selectedLine ? currentCurve(selectedLine) : 0;
  const endingOptions = LINE_ENDING_OPTIONS.map((ending) => ({ value: String(ending), label: t(LINE_ENDING_LABEL_KEYS[ending] ?? "annotate.endNone") }));
  const endingFromValue = (value: string) => LINE_ENDING_OPTIONS.find((ending) => String(ending) === value) ?? LINE_ENDING_OPTIONS[0];

  const selectedObjectId = selected?.object.id ?? null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const object = selectedRef.current?.object;
    if (!object) return;
    const values = styleValuesOf(object);
    if (values.color !== undefined) setColor(values.color);
    if (values.fill !== undefined) setFill(values.fill);
    if (values.strokeWidth !== undefined) setStrokeWidth(values.strokeWidth);
    if (values.opacity !== undefined) setOpacity(values.opacity);
    if (values.dashed !== undefined) setDashed(values.dashed);
  }, [selectedObjectId]);

  const applyStyle = (next: StyleValues) => {
    if (next.color !== undefined) setColor(next.color);
    if (next.fill !== undefined) setFill(next.fill);
    if (next.strokeWidth !== undefined) setStrokeWidth(next.strokeWidth);
    if (next.opacity !== undefined) setOpacity(next.opacity);
    if (next.dashed !== undefined) setDashed(next.dashed);
    const nextEndings = next.lineEndings;
    if (nextEndings && activeTool) setToolEndings((current) => ({ ...current, [activeTool]: nextEndings }));
    if (!annotation) return;
    if (activeTool) {
      annotationCapability?.setToolDefaults(activeTool, stylePatchFor(activeTool, next));
    }
    for (const { object } of selectedMarks) {
      const markTool = SUBTYPE_TOOLS[object.type] ?? "ink";
      annotation.updateAnnotation(object.pageIndex, object.id, { ...stylePatchFor(markTool, next), author: object.author });
    }
  };

  const selectionScope = selection?.forDocument(documentId) ?? null;

  const selectionRects = (): Record<string, Rect[]> => (selectionScope?.getHighlightRects() ?? {}) as Record<string, Rect[]>;

  const markSelection = (toolId: string, toolColor: string) => {
    markupSelection({ annotation, selection: selectionScope, toolId, color: toolColor, opacity, defaults: annotationCapability?.getTool(toolId)?.defaults ?? {} });
  };

  const placeTextPlaceholder = () => {
    const tool = annotationCapability?.getTool("freeText");
    if (!annotationCapability || !tool) return;
    annotationCapability.setToolDefaults("freeText", { contents: textPlaceholder });
    const clickBehavior = "clickBehavior" in tool ? tool.clickBehavior : undefined;
    if (clickBehavior && "defaultContent" in clickBehavior && clickBehavior.defaultContent !== textPlaceholder) {
      annotationCapability.addTool({ ...annotationCapability.getTool("freeText"), clickBehavior: { ...clickBehavior, defaultContent: textPlaceholder } } as typeof tool);
    }
  };

  const selectTool = (id: string) => {
    useMarkToolStore.getState().stop();
    if (redactActive) redaction?.toggleRedact();
    const next = activeTool === id ? null : id;
    if (next) {
      const toolColor = toolColorFrom(next, annotationCapability?.getTool(next)?.defaults as Record<string, unknown> | undefined) ?? color;
      setColor(toolColor);
      annotationCapability?.setToolDefaults(next, stylePatchFor(next, { color: toolColor, fill, strokeWidth, opacity, dashed, lineEndings: toolEndings[next] }));
      if (next === "freeText") placeTextPlaceholder();
      markSelection(next, toolColor);
    }
    annotation?.setActiveTool(next);
  };

  const disarmTools = () => {
    useMarkToolStore.getState().stop();
    annotation?.setActiveTool(null);
    if (redaction?.isRedactActive()) redaction.toggleRedact();
  };

  const disarmRef = useRef(disarmTools);
  disarmRef.current = disarmTools;

  useEffect(() => {
    return () => disarmRef.current();
  }, []);

  const textPlaceholder = t("annotate.textPlaceholder");
  const selectionKey = (annotationState.selectedUids ?? []).join("|");
  const previousSelection = useRef<string[]>([]);

  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectionKey ? selectionKey.split("|") : [];
    if (!annotation || previous.length === 0) return;
    window.setTimeout(() => {
      const state = annotation.getState();
      const dropped = droppedUntouchedTexts(previous, state.selectedUids ?? [], state.byUid, [ENGINE_TEXT_PLACEHOLDER, textPlaceholder]);
      if (dropped.length > 0) annotation.deleteAnnotations(dropped);
    }, UNTOUCHED_TEXT_DELAY_MS);
  }, [selectionKey, annotation, textPlaceholder]);

  const closeBar = () => {
    disarmTools();
    onClose?.();
  };

  const toggleRedact = () => {
    useMarkToolStore.getState().stop();
    annotation?.setActiveTool(null);
    if (!redactActive && redaction && hasSelectionRects(selectionRects())) {
      void redaction
        .queueCurrentSelectionAsPending()
        .toPromise()
        .then(() => {
          selectionScope?.clear();
          toast("success", t("viewer.selection.redactQueued"));
        })
        .catch((caught) => toast("error", describeError(t, toRpcError(caught))));
    }
    redaction?.toggleRedact();
  };

  const applyCurve = (next: number) => {
    if (!annotation || !selectedLine || !curvableLine) return;
    const { start, end } = lineEndpoints(selectedLine);
    const vertices = curvedVertices(start, end, next);
    const pageIndex = selectedLine.pageIndex;
    if (selectedLine.type === PdfAnnotationSubtype.POLYLINE) {
      annotation.updateAnnotation(pageIndex, selectedLine.id, { vertices, ...curveRectPatch(vertices, selectedLine.strokeWidth), author: selectedLine.author });
      return;
    }
    if (next === 0) return;
    const polyline = polylineFromLine(selectedLine, vertices, crypto.randomUUID());
    annotation.deleteAnnotation(pageIndex, selectedLine.id);
    annotation.createAnnotation(pageIndex, polyline);
    annotation.selectAnnotation(pageIndex, polyline.id);
  };

  const deleteSelected = () => {
    annotation?.deleteAnnotations(selectedMarks.map(({ object }) => ({ pageIndex: object.pageIndex, id: object.id })));
  };

  const deleteAll = () => {
    setDeleteAllOpen(false);
    annotation?.deleteAnnotations(allMarks(annotationState.byUid ?? {}));
  };

  const pickPointer = () => {
    useMarkToolStore.getState().stop();
    annotation?.setActiveTool(null);
    if (redactActive) redaction?.toggleRedact();
  };

  const toggleArea = () => {
    annotation?.setActiveTool(null);
    if (redactActive) redaction?.toggleRedact();
    useMarkToolStore.getState().toggle(documentId, "area");
  };

  const toggleEraser = () => {
    annotation?.setActiveTool(null);
    annotation?.deselectAnnotation();
    if (redactActive) redaction?.toggleRedact();
    useMarkToolStore.getState().toggle(documentId, "erase");
  };

  const saveTo = async (path?: string) => {
    if (!document) return;
    setSaving(true);
    try {
      await saveDocument(path);
    } finally {
      setSaving(false);
    }
  };

  const requestOverwrite = () => {
    if (!document) return;
    setOverwriteOpen(true);
  };

  const confirmOverwrite = async () => {
    if (!document) return;
    setOverwriteOpen(false);
    await saveTo();
  };

  const saveAs = async () => {
    if (!document) return;
    const selectedPath = await saveDialog({ defaultPath: suggestOutputPath(document.path, t("annotate.suffix")), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (selectedPath) await saveTo(selectedPath.toLowerCase().endsWith(".pdf") ? selectedPath : `${selectedPath}.pdf`);
  };

  const deleteAllDialog = (
    <Dialog
      open={deleteAllOpen}
      title={t("annotate.deleteAllTitle")}
      onClose={() => setDeleteAllOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDeleteAllOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={deleteAll}>
            {t("annotate.deleteAll")}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t("annotate.deleteAllBody", { count: markCount, name: document?.fileName ?? "" })}</p>
    </Dialog>
  );

  const overwriteDialog = (
    <Dialog
      open={overwriteOpen}
      title={t("annotate.overwriteTitle")}
      onClose={() => setOverwriteOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOverwriteOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void confirmOverwrite()}>
            {t("tools.overwrite")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p>{t("annotate.overwriteBody", { name: document?.fileName ?? "" })}</p>
        {pendingCount > 0 ? <p className="text-destructive">{t("annotate.overwriteRedactionWarning", { count: pendingCount })}</p> : null}
      </div>
    </Dialog>
  );

  if (layout === "dock") {
    return (
      <div className="glass flex w-12 flex-col items-center gap-1 rounded-2xl p-1.5">
        <IconButton icon={MousePointer2} label={t("annotate.select")} active={!activeTool && !redactActive && !markMode} onClick={pickPointer} />
        <IconButton icon={SquareDashedMousePointer} label={t("annotate.areaSelect")} active={areaActive} onClick={toggleArea} />
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        {TOOLS.map((tool) => (
          <Fragment key={tool.id}>
            <IconButton icon={tool.icon} label={t(tool.labelKey)} active={activeTool === tool.id} onClick={() => selectTool(tool.id)} />
            {tool.id === "ink" ? <IconButton icon={Eraser} label={t("annotate.eraser")} active={eraseActive} onClick={toggleEraser} /> : null}
          </Fragment>
        ))}
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        <div role="radiogroup" aria-label={t("annotate.color")} className="grid grid-cols-2 gap-1.5 px-0.5 py-0.5">
          {swatches.map((preset, index) => (
            <button
              key={preset}
              ref={colorRoving.refOf(index)}
              type="button"
              role="radio"
              aria-checked={preset.toLowerCase() === color.toLowerCase()}
              aria-label={t("annotate.colorSwatch", { index: index + 1, total: swatches.length, value: preset })}
              title={preset}
              tabIndex={colorRoving.tabIndexOf(index)}
              onKeyDown={colorRoving.onKeyDown}
              onClick={() => applyStyle({ color: preset })}
              className={cn(
                "size-3.5 rounded-full border transition-transform duration-(--transition-fast) hover:scale-110",
                preset.toLowerCase() === color.toLowerCase() ? "border-foreground ring-2 ring-ring/40" : "border-border",
              )}
              style={{ backgroundColor: preset }}
            />
          ))}
        </div>
        {showStroke ? (
          <div className="flex w-full flex-col items-center gap-0.5 py-0.5">
            <input
              type="range"
              min={MIN_STROKE_WIDTH}
              max={MAX_STROKE_WIDTH}
              step={STROKE_WIDTH_STEP}
              value={strokeWidth}
              onChange={(event) => applyStyle({ strokeWidth: Number(event.target.value) })}
              className="w-9 accent-primary"
              aria-label={t("annotate.strokeWidth")}
            />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{strokeWidth}</span>
          </div>
        ) : null}
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        <IconButton icon={Undo2} label={t("tools.pages.undo")} disabled={!historyState.canUndo} onClick={() => history?.undo()} />
        <IconButton icon={Redo2} label={t("tools.pages.redo")} disabled={!historyState.canRedo} onClick={() => history?.redo()} />
        <IconButton icon={Trash2} label={t("annotate.deleteSelected")} disabled={selectedMarks.length === 0} onClick={deleteSelected} />
        <IconButton icon={BrushCleaning} label={t("annotate.deleteAll")} disabled={markCount === 0} onClick={() => setDeleteAllOpen(true)} />
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        <IconButton icon={Save} label={t("annotate.save")} disabled={!exporter || !document || saving} onClick={requestOverwrite} />
        <IconButton icon={SaveAll} label={t("annotate.saveAs")} disabled={!exporter || saving} onClick={() => void saveAs()} />
        {overwriteDialog}
        {deleteAllDialog}
      </div>
    );
  }

  return (
    <div className="relative z-40 glass-flat border-b">
      <div className="flex h-row items-center gap-1.5 px-2">
        <IconButton icon={MousePointer2} label={t("annotate.select")} active={!activeTool && !redactActive && !markMode} onClick={pickPointer} />
        <IconButton icon={SquareDashedMousePointer} label={t("annotate.areaSelect")} active={areaActive} onClick={toggleArea} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {TOOLS.map((tool) => (
          <Fragment key={tool.id}>
            <IconButton icon={tool.icon} label={t(tool.labelKey)} active={activeTool === tool.id} onClick={() => selectTool(tool.id)} />
            {tool.id === "ink" ? <IconButton icon={Eraser} label={t("annotate.eraser")} active={eraseActive} onClick={toggleEraser} /> : null}
          </Fragment>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={ScanEye} label={t("annotate.redact")} active={redactActive} onClick={toggleRedact} />
        {pendingCount > 0 ? (
          <Button size="sm" variant="destructive" icon={<Eraser className="size-4" aria-hidden />} onClick={() => void redaction?.commitAllPending()}>
            {t("annotate.applyRedactions", { count: pendingCount })}
          </Button>
        ) : null}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Trash2} label={t("annotate.deleteSelected")} disabled={selectedMarks.length === 0} onClick={deleteSelected} />
        <IconButton icon={BrushCleaning} label={t("annotate.deleteAll")} disabled={markCount === 0} onClick={() => setDeleteAllOpen(true)} />
        <IconButton icon={Undo2} label={t("tools.pages.undo")} disabled={!historyState.canUndo} onClick={() => history?.undo()} />
        <IconButton icon={Redo2} label={t("tools.pages.redo")} disabled={!historyState.canRedo} onClick={() => history?.redo()} />
        <span className="flex-1" />
        <Button size="sm" icon={<SaveAll className="size-4" aria-hidden />} onClick={() => void saveAs()} loading={saving} disabled={!exporter}>
          {t("annotate.saveAs")}
        </Button>
        <Button size="sm" variant="primary" icon={<Save className="size-4" aria-hidden />} onClick={requestOverwrite} loading={saving} disabled={!exporter || !document}>
          {t("annotate.save")}
        </Button>
        <IconButton icon={X} label={t("common.close")} onClick={closeBar} />
      </div>
      {eraseActive ? (
        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-2 py-1 text-xs">
          <span className="glass-chip inline-flex h-7 items-center rounded-xl px-2.5 text-muted-foreground">{t("annotate.eraserHint")}</span>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("annotate.eraserSize")}</span>
            <input
              type="range"
              min={MIN_ERASER_SIZE}
              max={MAX_ERASER_SIZE}
              value={eraserSize}
              onChange={(event) => useMarkToolStore.getState().setEraserSize(Number(event.target.value))}
              className="w-28 accent-primary"
              aria-label={t("annotate.eraserSize")}
            />
            <span className="w-12 text-end font-mono tabular-nums">{eraserSize} px</span>
          </div>
        </div>
      ) : styleTarget ? (
        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-2 py-1 text-xs">
          <span className="glass-chip inline-flex h-7 items-center rounded-xl px-2.5 text-muted-foreground">
            {styleTarget !== "selected" ? t("annotate.newMarks") : selectedMarks.length > 1 ? t("annotate.selectedMarks", { count: selectedMarks.length }) : t("annotate.selectedMark")}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{showFill ? t("annotate.stroke") : t("annotate.color")}</span>
            <ColorSwatch
              value={color}
              onChange={(next) => applyStyle({ color: next })}
              label={showFill ? t("annotate.stroke") : t("annotate.color")}
              customLabel={t("colorPicker.custom")}
              presets={presets}
            />
          </div>
          {showFill ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("annotate.fill")}</span>
              <button
                type="button"
                role="switch"
                aria-checked={fill !== null}
                onClick={() => applyStyle({ fill: fill === null ? color : null })}
                className={cn("glass-chip h-7 rounded-xl px-2.5 text-xs", fill === null ? "text-muted-foreground" : "text-foreground")}
              >
                {fill === null ? t("annotate.noFill") : t("annotate.filled")}
              </button>
              {fill !== null ? (
                <ColorSwatch
                  value={fill}
                  onChange={(next) => applyStyle({ fill: next })}
                  label={t("annotate.fill")}
                  customLabel={t("colorPicker.custom")}
                  presets={presets}
                />
              ) : null}
            </div>
          ) : null}
          {showStroke ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("annotate.strokeWidth")}</span>
              <input
                type="range"
                min={MIN_STROKE_WIDTH}
                max={MAX_STROKE_WIDTH}
                step={STROKE_WIDTH_STEP}
                value={strokeWidth}
                onChange={(event) => applyStyle({ strokeWidth: Number(event.target.value) })}
                className="w-28 accent-primary"
                aria-label={t("annotate.strokeWidth")}
              />
              <span className="w-12 text-end font-mono tabular-nums">{strokeWidth} px</span>
            </div>
          ) : null}
          {showDash ? (
            <button
              type="button"
              role="switch"
              aria-checked={dashed}
              onClick={() => applyStyle({ dashed: !dashed })}
              className={cn("glass-chip h-7 rounded-xl px-2.5 text-xs", dashed ? "text-foreground" : "text-muted-foreground")}
            >
              {dashed ? t("annotate.dashed") : t("annotate.solid")}
            </button>
          ) : null}
          {showEndings ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("annotate.ends")}</span>
              <Select
                size="sm"
                className="w-28"
                value={String(endings.start)}
                options={endingOptions}
                ariaLabel={t("annotate.endStart")}
                onChange={(value) => applyStyle({ lineEndings: { start: endingFromValue(value), end: endings.end } })}
              />
              <Select
                size="sm"
                className="w-28"
                value={String(endings.end)}
                options={endingOptions}
                ariaLabel={t("annotate.endEnd")}
                onChange={(value) => applyStyle({ lineEndings: { start: endings.start, end: endingFromValue(value) } })}
              />
            </div>
          ) : null}
          {curvableLine ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("annotate.curve")}</span>
              <input
                type="range"
                min={MIN_CURVE}
                max={MAX_CURVE}
                step={CURVE_STEP}
                value={curve}
                onChange={(event) => applyCurve(Number(event.target.value))}
                className="w-28 accent-primary"
                aria-label={t("annotate.curve")}
              />
              <span className="w-9 text-end font-mono tabular-nums">{curve}</span>
              <button
                type="button"
                onClick={() => applyCurve(0)}
                disabled={curve === 0}
                className={cn("glass-chip h-7 rounded-xl px-2.5 text-xs", curve === 0 ? "text-muted-foreground opacity-60" : "text-foreground")}
              >
                {t("annotate.straighten")}
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("annotate.opacity")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(event) => applyStyle({ opacity: Number(event.target.value) / 100 })}
              className="w-28 accent-primary"
              aria-label={t("annotate.opacity")}
            />
            <span className="w-9 text-end font-mono tabular-nums">{Math.round(opacity * 100)}%</span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-2 py-1 text-xs">
          <span className="glass-chip inline-flex h-7 items-center rounded-xl px-2.5 text-muted-foreground">{t("annotate.styleHint")}</span>
        </div>
      )}
      {overwriteDialog}
      {deleteAllDialog}
    </div>
  );
}
