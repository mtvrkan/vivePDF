import { useEffect, useRef, useState } from "react";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import {
  ArrowRight,
  Baseline,
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
import { PdfAnnotationSubtype, type LineEndings, type PdfAnnotationObject, type PdfLineAnnoObject, type PdfPolylineAnnoObject, type Rect } from "@embedpdf/models";
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
import { DASH_TOOLS, DEFAULT_LINE_ENDINGS, FALLBACK_COLORS, FILL_TOOLS, LINE_ENDING_LABEL_KEYS, LINE_ENDING_OPTIONS, LINE_TOOLS, MAX_STROKE_WIDTH, MIN_STROKE_WIDTH, STROKE_TOOLS, STROKE_WIDTH_STEP, SUBTYPE_TOOLS, stylePatchFor, type StyleValues } from "./annotateStyle";
import { CURVE_STEP, MAX_CURVE, MIN_CURVE, currentCurve, curveRectPatch, curvedVertices, lineEndpoints, polylineFromLine } from "./lineCurve";
import { MARKUP_SUBTYPES, hasSelectionRects, markupRequests } from "./selectionMarkup";

type Tool = { id: string; icon: LucideIcon; labelKey: string };

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
  const selected = annotation?.getSelectedAnnotation() ?? null;
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
  const selectedLine = asLineLike(selected?.object);
  const endings = selectedLine?.lineEndings ?? toolEndings[styleTool ?? ""] ?? DEFAULT_LINE_ENDINGS.lineArrow;
  const curve = selectedLine ? currentCurve(selectedLine) : 0;
  const endingOptions = LINE_ENDING_OPTIONS.map((ending) => ({ value: String(ending), label: t(LINE_ENDING_LABEL_KEYS[ending] ?? "annotate.endNone") }));
  const endingFromValue = (value: string) => LINE_ENDING_OPTIONS.find((ending) => String(ending) === value) ?? LINE_ENDING_OPTIONS[0];

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
    if (selected) {
      const selectedTool = SUBTYPE_TOOLS[selected.object.type] ?? "ink";
      annotation.updateAnnotation(selected.object.pageIndex, selected.object.id, { ...stylePatchFor(selectedTool, next), author: selected.object.author });
    }
  };

  const selectionScope = selection?.forDocument(documentId) ?? null;

  const selectionRects = (): Record<string, Rect[]> => (selectionScope?.getHighlightRects() ?? {}) as Record<string, Rect[]>;

  const markSelection = (toolId: string) => {
    const subtype = MARKUP_SUBTYPES[toolId];
    if (subtype === undefined || !annotation || !selectionScope) return;
    const requests = markupRequests(selectionRects());
    if (requests.length === 0) return;
    const defaults = annotationCapability?.getTool(toolId)?.defaults ?? {};
    for (const request of requests) {
      annotation.createAnnotation(request.pageIndex, {
        ...defaults,
        ...stylePatchFor(toolId, { color, opacity }),
        type: subtype,
        id: crypto.randomUUID(),
        pageIndex: request.pageIndex,
        rect: request.rect,
        segmentRects: request.segmentRects,
      } as PdfAnnotationObject);
    }
    selectionScope.clear();
  };

  const selectTool = (id: string) => {
    if (redactActive) redaction?.toggleRedact();
    const next = activeTool === id ? null : id;
    if (next) {
      annotationCapability?.setToolDefaults(next, stylePatchFor(next, { color, fill, strokeWidth, opacity, dashed, lineEndings: toolEndings[next] }));
      markSelection(next);
    }
    annotation?.setActiveTool(next);
  };

  const disarmTools = () => {
    annotation?.setActiveTool(null);
    if (redaction?.isRedactActive()) redaction.toggleRedact();
  };

  const disarmRef = useRef(disarmTools);
  disarmRef.current = disarmTools;

  useEffect(() => {
    return () => disarmRef.current();
  }, []);

  const closeBar = () => {
    disarmTools();
    onClose?.();
  };

  const toggleRedact = () => {
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
    if (!annotation || !selectedLine) return;
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
    if (selected) annotation?.deleteAnnotation(selected.object.pageIndex, selected.object.id);
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
        <IconButton icon={MousePointer2} label={t("annotate.select")} active={!activeTool && !redactActive} onClick={() => { annotation?.setActiveTool(null); if (redactActive) redaction?.toggleRedact(); }} />
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        {TOOLS.map((tool) => (
          <IconButton key={tool.id} icon={tool.icon} label={t(tool.labelKey)} active={activeTool === tool.id} onClick={() => selectTool(tool.id)} />
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
        <IconButton icon={Trash2} label={t("annotate.deleteSelected")} disabled={!annotationState.selectedUid} onClick={deleteSelected} />
        <span className="my-0.5 h-px w-6 bg-border" aria-hidden />
        <IconButton icon={Save} label={t("annotate.save")} disabled={!exporter || !document || saving} onClick={requestOverwrite} />
        <IconButton icon={SaveAll} label={t("annotate.saveAs")} disabled={!exporter || saving} onClick={() => void saveAs()} />
        {overwriteDialog}
      </div>
    );
  }

  return (
    <div className="relative z-40 glass-flat border-b">
      <div className="flex h-row items-center gap-1.5 px-2">
        <IconButton icon={MousePointer2} label={t("annotate.select")} active={!activeTool && !redactActive} onClick={() => { annotation?.setActiveTool(null); if (redactActive) redaction?.toggleRedact(); }} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {TOOLS.map((tool) => (
          <IconButton key={tool.id} icon={tool.icon} label={t(tool.labelKey)} active={activeTool === tool.id} onClick={() => selectTool(tool.id)} />
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={ScanEye} label={t("annotate.redact")} active={redactActive} onClick={toggleRedact} />
        {pendingCount > 0 ? (
          <Button size="sm" variant="destructive" icon={<Eraser className="size-4" aria-hidden />} onClick={() => void redaction?.commitAllPending()}>
            {t("annotate.applyRedactions", { count: pendingCount })}
          </Button>
        ) : null}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Trash2} label={t("annotate.deleteSelected")} disabled={!annotationState.selectedUid} onClick={deleteSelected} />
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
      {styleTarget ? (
        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-2 py-1 text-xs">
          <span className="glass-chip inline-flex h-7 items-center rounded-xl px-2.5 text-muted-foreground">
            {styleTarget === "selected" ? t("annotate.selectedMark") : t("annotate.newMarks")}
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
          {selectedLine ? (
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
      ) : null}
      {overwriteDialog}
    </div>
  );
}
