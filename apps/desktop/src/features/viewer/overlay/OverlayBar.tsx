import { useEffect, useRef, useState } from "react";
import { Camera, Crop, Eraser, ImagePlus, Link2, PenTool, Plus, RotateCcw, Ruler, Save, SaveAll, ScanText, SquareDashed, Trash2, Type, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useRedaction } from "@embedpdf/plugin-redaction/react";
import { requestSearchable } from "../searchableStore";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { PdfActionType, PdfAnnotationSubtype, PdfZoomMode } from "@embedpdf/models";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { TextInput } from "@/components/tool/form";
import { basenameOf, suggestOutputPath } from "@/shared/lib/paths";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { normalizeLinkUri } from "../linkUri";
import { applyEditor, cropPages, imagePreview, placeSignature, redactPdf } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSignatureStore } from "@/shared/store/signatureStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { EDITOR_MODES, useViewerOverlayStore, type EditorPending, type MeasureUnit } from "@/shared/store/viewerOverlayStore";
import type { EditorObject } from "@/types";
import { Dialog } from "@/components/shared/Dialog";
import { useOpenPdf } from "../useOpenPdf";
import { clearEmbeddedFontCache } from "./embeddedFonts";
import { formatArea, formatLength, measureDistance, rectAreaMm2 } from "./measure";
import { unrotatedRect, visiblePageSize } from "./pageSize";
import { SignatureDialog } from "./SignatureDialog";
import { DrawingEditorHost } from "./drawing/DrawingEditorHost";
import { tidyAlt } from "./drawing/drawingAltText";
import { DRAWING_SPECS, drawingAltText } from "./drawing/drawingKinds";
import { DRAWING_KINDS, isDrawingImage, toDrawingObject } from "./drawing/drawingSource";
import { isPendingChange } from "./pending";
import { hasMixedStyles, toEditorRun } from "./runs";

const MM_TO_PT = 72 / 25.4;
const ERASE_FILL = "#ffffff";
const UNITS: MeasureUnit[] = ["mm", "cm", "m"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "heic", "heif"];

export function OverlayBar({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const { openPath, closeDocument } = useOpenPdf();
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const mode = useViewerOverlayStore((state) => state.mode);
  const selection = useViewerOverlayStore((state) => state.selection);
  const measure = useViewerOverlayStore((state) => state.measure);
  const scaleDenominator = useViewerOverlayStore((state) => state.scaleDenominator);
  const unit = useViewerOverlayStore((state) => state.unit);
  const signatureId = useViewerOverlayStore((state) => state.signatureId);
  const signatureWidthMm = useViewerOverlayStore((state) => state.signatureWidthMm);
  const placement = useViewerOverlayStore((state) => state.placement);
  const objects = useViewerOverlayStore((state) => state.objects);
  const selectedObjectId = useViewerOverlayStore((state) => state.selectedObjectId);
  const pendingImage = useViewerOverlayStore((state) => state.pendingImage);
  const setMode = useViewerOverlayStore((state) => state.setMode);
  const signatures = useSignatureStore((state) => state.items);
  const { provides: redaction } = useRedaction(documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPage, setLinkPage] = useState("");
  const leaveNext = useViewerOverlayStore((state) => state.leaveNext);

  useEffect(() => {
    return () => {
      useViewerOverlayStore.getState().setMode(null);
      clearEmbeddedFontCache(documentId);
    };
  }, [documentId]);

  const actionsRef = useRef<{ save: (inPlace: boolean) => void }>({ save: () => undefined });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useViewerOverlayStore.getState();
      if (!state.mode || !EDITOR_MODES.includes(state.mode) || state.drawingEditor) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "s") {
        event.preventDefault();
        actionsRef.current.save(!event.shiftKey);
        return;
      }
      if (typing) return;
      const current = state.objects.find((item) => item.id === state.selectedObjectId) ?? null;
      if (event.key === "Escape") {
        if (window.document.querySelector("[role=menu], [role=dialog], [role=listbox]")) return;
        event.preventDefault();
        if (state.editingObjectId) state.setEditingObject(null);
        else if (current) state.setSelectedObject(null);
        else state.requestLeave(() => state.setMode(null), state.objects.filter(isPendingChange).length > 0);
        return;
      }
      if (modifier && key === "z" && !state.editingObjectId) {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (modifier && key === "y" && !state.editingObjectId) {
        event.preventDefault();
        state.redo();
        return;
      }
      if (modifier && key === "b") {
        event.preventDefault();
        const style = current && (current.kind === "text" || current.kind === "edit" || current.kind === "block") ? current.style : state.textStyle;
        state.setTextStyle({ bold: !style.bold });
        return;
      }
      if (modifier && key === "i" && (current?.kind === "edit" || current?.kind === "block")) {
        event.preventDefault();
        state.updateObject(current.id, { style: { ...current.style, italic: !current.style.italic } } as Partial<EditorPending>);
        return;
      }
      if (modifier && key === "c" && current && !state.editingObjectId) {
        event.preventDefault();
        state.copyObject(current);
        return;
      }
      if (modifier && key === "v" && state.clipboard && !state.editingObjectId) {
        event.preventDefault();
        const targetPageIndex = current ? current.pageIndex : state.clipboard.pageIndex;
        const targetPage = visiblePageSize(documentId, targetPageIndex, 1, 1);
        state.pasteObject(targetPageIndex, targetPage.width, targetPage.height);
        return;
      }
      if (event.key === "Tab" && !modifier && !state.editingObjectId && state.objects.length > 0) {
        event.preventDefault();
        const pageIndex = current ? current.pageIndex : state.objects[0].pageIndex;
        const onPage = state.objects.filter((item) => item.pageIndex === pageIndex);
        if (onPage.length > 0) {
          const currentIndex = current ? onPage.findIndex((item) => item.id === current.id) : -1;
          const nextIndex = event.shiftKey ? (currentIndex - 1 + onPage.length) % onPage.length : (currentIndex + 1) % onPage.length;
          state.setSelectedObject(onPage[nextIndex].id);
        }
        return;
      }
      if (!current || state.editingObjectId) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.snapshot();
        if ((current.kind === "edit" || current.kind === "block") && current.text !== "") state.updateObject(current.id, { text: "" });
        else if (current.kind === "imageChange" && !current.deleted) state.updateObject(current.id, { deleted: true });
        else state.removeObject(current.id);
        return;
      }
      if (event.key === "Enter" && isDrawingImage(current)) {
        event.preventDefault();
        state.openDrawingEditor(current.drawing.kind, current.id);
        return;
      }
      if (event.key === "Enter" && (current.kind === "text" || current.kind === "edit" || current.kind === "block")) {
        event.preventDefault();
        state.setEditingObject(current.id);
        return;
      }
      if (modifier && key === "d" && (current.kind === "text" || current.kind === "image")) {
        event.preventDefault();
        state.addObject({ ...current, id: crypto.randomUUID(), x: current.x + 12, y: current.y + 12 });
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = nudge[event.key];
      if (delta) {
        event.preventDefault();
        state.updateObject(current.id, { x: Math.max(0, current.x + delta[0]), y: Math.max(0, current.y + delta[1]) });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [documentId]);

  if (!mode || !document) return null;

  const close = () => setMode(null);
  const store = useViewerOverlayStore.getState();
  const signature = signatures.find((item) => item.id === signatureId) ?? null;
  const selected = objects.find((item) => item.id === selectedObjectId) ?? null;

  const reloadDocument = async () => {
    closeDocument(documentId);
    await openPath(document.path);
  };

  const runGuarded = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const applyCrop = (allPages: boolean) =>
    runGuarded(async () => {
      if (!selection) return;
      const page = visiblePageSize(documentId, selection.pageIndex, 1, 1);
      const output = suggestOutputPath(document.path, t("tools.edit.crop.suffix"));
      await cropPages({
        path: document.path,
        password: document.password ?? undefined,
        output,
        pages: allPages ? undefined : String(selection.pageIndex + 1),
        insets: { left: selection.x0, top: selection.y0, right: Math.max(0, page.width - selection.x1), bottom: Math.max(0, page.height - selection.y1) },
      });
      toast("success", t("viewer.overlay.cropped", { name: basenameOf(output) }));
      close();
      await openPath(output);
    });

  const unturnedSelection = (area: NonNullable<typeof selection>) =>
    unrotatedRect(area, document.info?.pageSizes[area.pageIndex]?.rotation ?? 0, visiblePageSize(documentId, area.pageIndex, 0, 0));

  const applyErase = () =>
    runGuarded(async () => {
      if (!selection) return;
      const page = selection.pageIndex + 1;
      const area = unturnedSelection(selection);
      const output = suggestOutputPath(document.path, t("viewer.overlay.erasedSuffix"));
      await redactPdf({
        path: document.path,
        password: document.password ?? undefined,
        output,
        pages: String(page),
        areas: [{ page, ...area }],
        searchText: [],
        patterns: [],
        presets: [],
        caseSensitive: false,
        fill: ERASE_FILL,
        images: "overlapping",
        graphics: "contained",
      });
      toast("success", t("viewer.overlay.erased", { name: basenameOf(output) }));
      close();
      await openPath(output);
    });

  const applyRedact = () =>
    runGuarded(async () => {
      if (!selection || !redaction) return;
      const area = unturnedSelection(selection);
      redaction.addPending([
        {
          id: crypto.randomUUID(),
          page: selection.pageIndex,
          rect: { origin: { x: area.x0, y: area.y0 }, size: { width: area.x1 - area.x0, height: area.y1 - area.y0 } },
          source: "annotation",
          markColor: "#ffb3b3",
          redactionColor: "#000000",
          kind: "area",
        },
      ]);
      toast("success", t("viewer.selection.redactQueued"));
      useViewerOverlayStore.getState().setSelection(null);
    });

  const applyLink = () =>
    runGuarded(async () => {
      if (!selection || !annotation) return;
      const targetPage = Number.parseInt(linkPage, 10);
      const trimmed = linkUrl.trim();
      const uri = trimmed ? normalizeLinkUri(trimmed) : null;
      if (trimmed && !uri) {
        toast("error", t("viewer.link.invalidUrl"));
        return;
      }
      if (!uri && !Number.isFinite(targetPage)) return;
      const pageIndex = selection.pageIndex;
      const area = unturnedSelection(selection);
      annotation.createAnnotation(pageIndex, {
        type: PdfAnnotationSubtype.LINK,
        id: crypto.randomUUID(),
        pageIndex,
        rect: { origin: { x: area.x0, y: area.y0 }, size: { width: area.x1 - area.x0, height: area.y1 - area.y0 } },
        target: uri
          ? { type: "action", action: { type: PdfActionType.URI, uri } }
          : { type: "destination", destination: { pageIndex: targetPage - 1, zoom: { mode: PdfZoomMode.FitPage }, view: [] } },
      });
      toast("success", t("viewer.link.queued"));
      store.setSelection(null);
      setLinkUrl("");
      setLinkPage("");
    });

  const applySignature = () =>
    runGuarded(async () => {
      if (!signature || !placement) return;
      const widthPt = signatureWidthMm * MM_TO_PT;
      const heightPt = (widthPt * signature.height) / signature.width;
      const output = suggestOutputPath(document.path, t("viewer.overlay.signatureSuffix"));
      await placeSignature({
        path: document.path,
        password: document.password ?? undefined,
        output,
        placements: [{ page: placement.pageIndex + 1, x0: placement.x - widthPt / 2, y0: placement.y - heightPt / 2, x1: placement.x + widthPt / 2, y1: placement.y + heightPt / 2, pngBase64: signature.dataUrl.replace(/^data:image\/png;base64,/, "") }],
      });
      toast("success", t("viewer.overlay.signed", { name: basenameOf(output) }));
      close();
      await openPath(output);
    });

  const editorObjects = (): EditorObject[] =>
    objects
      .filter(isPendingChange)
      .map((item) =>
        item.kind === "text"
          ? { id: item.id, kind: "text", page: item.pageIndex + 1, x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height, text: item.text, fontSize: item.style.fontSize, color: item.style.color, bold: item.style.bold, align: item.style.align, opacity: item.opacity, fontId: item.style.fontId, runs: item.runs && hasMixedStyles(item.runs) ? item.runs.map(toEditorRun) : undefined }
          : item.kind === "edit"
            ? { id: item.id, kind: "edit", page: item.pageIndex + 1, x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height, text: item.text, fontSize: item.style.fontSize, color: item.style.color, bold: item.style.bold, italic: item.style.italic, font: item.style.font, opacity: item.opacity }
            : item.kind === "block"
              ? {
                  id: item.id,
                  kind: "block",
                  page: item.pageIndex + 1,
                  x0: item.x,
                  y0: item.y,
                  x1: item.x + item.width,
                  y1: item.y + item.height,
                  text: item.text,
                  fontSize: item.style.fontSize,
                  color: item.style.color,
                  bold: item.style.bold,
                  italic: item.style.italic,
                  font: item.style.font,
                  align: item.style.align,
                  lineHeight: item.style.lineHeight,
                  original: [item.originalRect.x, item.originalRect.y, item.originalRect.x + item.originalRect.width, item.originalRect.y + item.originalRect.height],
                  fontXref: item.fontXref || undefined,
                  runs: item.runs.map(toEditorRun),
                  firstLineIndent: item.firstLineIndent,
                  leading: item.leading,
                  rotated: item.rotated,
                  opacity: item.opacity,
                }
              : item.kind === "imageChange"
                ? {
                    id: item.id,
                    kind: "imageChange",
                    page: item.pageIndex + 1,
                    x0: item.original.x,
                    y0: item.original.y,
                    x1: item.original.x + item.original.width,
                    y1: item.original.y + item.original.height,
                    xref: item.xref,
                    ...(item.deleted ? {} : { newX0: item.x, newY0: item.y, newX1: item.x + item.width, newY1: item.y + item.height }),
                    ...(item.replacement ? (item.replacement.path ? { replacementPath: item.replacement.path } : { replacementPngBase64: item.replacement.dataUrl.replace(/^data:image\/\w+;base64,/, "") }) : {}),
                    rotate: item.rotate,
                    flipH: item.flipH,
                    flipV: item.flipV,
                    aspectLocked: item.aspectLocked,
                    opacity: item.opacity,
                  }
                : isDrawingImage(item)
                  ? toDrawingObject(item, drawingAltText(item.drawing, t))
                  : { id: item.id, kind: "image", page: item.pageIndex + 1, x0: item.x, y0: item.y, x1: item.x + item.width, y1: item.y + item.height, pngBase64: item.path ? undefined : item.dataUrl.replace(/^data:image\/\w+;base64,/, ""), path: item.path ?? undefined, opacity: item.opacity, ...(item.alt?.trim() ? { alt: tidyAlt(item.alt) } : {}) },
      );

  const saveEdits = (inPlace: boolean) =>
    runGuarded(async () => {
      const payload = editorObjects();
      if (payload.length === 0) return;
      let output: string | undefined;
      if (!inPlace) {
        const selectedPath = await saveDialog({ defaultPath: suggestOutputPath(document.path, t("viewer.overlay.editSuffix")), filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (typeof selectedPath !== "string") return;
        output = selectedPath.toLowerCase().endsWith(".pdf") ? selectedPath : `${selectedPath}.pdf`;
      }
      const result = await applyEditor({ path: document.path, password: document.password ?? undefined, inPlace, output, overwrite: true, objects: payload });
      toast("success", t("viewer.overlay.saved", { count: payload.length }));
      const actionable = result.warnings.filter((warning) => warning.severity !== "info");
      if (actionable.length > 0) toast("info", t("viewer.overlay.saveWarnings", { count: actionable.length }));
      if (inPlace) {
        const currentMode = mode;
        try {
          await reloadDocument();
        } catch (caught) {
          toast("error", describeError(t, toRpcError(caught)));
          return;
        }
        store.setWarnings(result.warnings);
        store.clearObjects();
        useViewerOverlayStore.getState().setMode(currentMode);
        return;
      }
      store.setWarnings(result.warnings);
      store.clearObjects();
      if (output) {
        close();
        await openPath(output);
      }
    });

  actionsRef.current.save = (inPlace) => void saveEdits(inPlace);

  const pickImage = () =>
    runGuarded(async () => {
      const selectedPath = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.scan.photo.images"), extensions: IMAGE_EXTENSIONS }] });
      if (typeof selectedPath !== "string") return;
      const preview = await imagePreview({ path: selectedPath });
      store.setPendingImage({ dataUrl: `data:image/png;base64,${preview.pngBase64}`, width: preview.width, height: preview.height, path: selectedPath });
    });


  const selectionSize = selection ? { width: selection.x1 - selection.x0, height: selection.y1 - selection.y0 } : null;
  const hasSelection = !!selectionSize && selectionSize.width > 2 && selectionSize.height > 2;
  const distance = measure && measure.points.length === 2 ? measureDistance(measure.points[0], measure.points[1]) * scaleDenominator : null;
  const pendingCount = objects.filter(isPendingChange).length;

  return (
    <>
      <div className="relative z-40 flex min-h-topbar flex-wrap items-center gap-2 glass-flat border-b px-3 py-1 text-sm">
        {mode === "crop" ? (
          <>
            <Crop className="size-4 text-primary" aria-hidden />
            <span className="text-muted-foreground">{hasSelection && selectionSize ? `${formatLength(selectionSize.width * (25.4 / 72), "mm", locale)} × ${formatLength(selectionSize.height * (25.4 / 72), "mm", locale)}` : t("viewer.overlay.cropHint")}</span>
            <span className="flex-1" />
            <Button size="sm" variant="primary" onClick={() => void applyCrop(false)} disabled={!hasSelection || busy} loading={busy}>{t("viewer.overlay.cropPage")}</Button>
            <Button size="sm" onClick={() => void applyCrop(true)} disabled={!hasSelection || busy}>{t("viewer.overlay.cropAll")}</Button>
            <Button size="sm" variant="destructive" icon={<Eraser className="size-4" aria-hidden />} onClick={() => void applyErase()} disabled={!hasSelection || busy}>{t("viewer.overlay.eraseArea")}</Button>
          </>
        ) : null}
        {mode === "redact" ? (
          <>
            <SquareDashed className="size-4 text-destructive" aria-hidden />
            <span className="text-muted-foreground">{t("viewer.overlay.redactHint")}</span>
            <span className="flex-1" />
            <Button size="sm" variant="destructive" onClick={() => void applyRedact()} disabled={!hasSelection || busy} loading={busy}>{t("viewer.overlay.redactApply")}</Button>
          </>
        ) : null}
        {mode === "areaText" ? (
          <>
            <ScanText className="size-4 text-primary" aria-hidden />
            <span className="text-muted-foreground">{t("viewer.areaText.hint")}</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => requestSearchable("document")}>
              {t("viewer.searchable.wholeDocument")}
            </Button>
          </>
        ) : null}
        {mode === "snapshot" ? (
          <>
            <Camera className="size-4 text-primary" aria-hidden />
            <span className="text-muted-foreground">{t("viewer.snapshot.hint")}</span>
          </>
        ) : null}
        {mode === "link" ? (
          <>
            <Link2 className="size-4 text-success" aria-hidden />
            <span className="text-muted-foreground">{hasSelection ? t("viewer.overlay.linkTarget") : t("viewer.overlay.linkHint")}</span>
            <TextInput value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" className="h-8 w-64 font-mono" aria-label={t("viewer.overlay.linkUrl")} disabled={!hasSelection} />
            <span className="text-xs text-muted-foreground">{t("viewer.overlay.linkOr")}</span>
            <TextInput value={linkPage} onChange={(event) => setLinkPage(event.target.value)} placeholder={t("viewer.overlay.linkPage")} inputMode="numeric" className="h-8 w-24 font-mono" aria-label={t("viewer.overlay.linkPage")} disabled={!hasSelection || linkUrl.length > 0} />
            <span className="flex-1" />
            <Button size="sm" variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => void applyLink()} disabled={!hasSelection || busy || (!linkUrl.trim() && !linkPage.trim())} loading={busy}>{t("viewer.overlay.linkAdd")}</Button>
          </>
        ) : null}
        {mode === "measure" ? (
          <>
            <Ruler className="size-4 text-primary" aria-hidden />
            <span className="font-mono tabular-nums">{distance !== null ? formatLength(distance, unit, locale) : t("viewer.overlay.measureHint")}</span>
            {selection ? <span className="text-muted-foreground">{formatArea(rectAreaMm2(selection.x1 - selection.x0, selection.y1 - selection.y0) * scaleDenominator ** 2, unit, locale)}</span> : null}
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("viewer.overlay.scale")}
              <TextInput type="number" min={1} value={scaleDenominator} onChange={(event) => store.setScaleDenominator(Number(event.target.value))} className="h-8 w-20 font-mono" aria-label={t("viewer.overlay.scale")} />
            </label>
            <Select value={unit} options={UNITS.map((value) => ({ value, label: value }))} onChange={(value) => store.setUnit(value as MeasureUnit)} ariaLabel={t("viewer.overlay.unit")} size="sm" />
            <IconButton icon={RotateCcw} label={t("viewer.overlay.reset")} onClick={() => store.resetMeasure()} disabled={!measure} />
          </>
        ) : null}
        {mode === "signature" ? (
          <>
            <PenTool className="size-4 text-primary" aria-hidden />
            <div className="flex items-center gap-1.5">
              {signatures.map((item) => (
                <button key={item.id} type="button" onClick={() => store.setSignatureId(item.id)} aria-pressed={item.id === signatureId} aria-label={item.name} className={item.id === signatureId ? "flex h-8 w-16 items-center justify-center rounded-lg bg-white ring-2 ring-primary" : "flex h-8 w-16 items-center justify-center rounded-lg bg-white/80 hover:bg-white"}>
                  <img src={item.dataUrl} alt="" className="max-h-6 max-w-14 object-contain" draggable={false} />
                </button>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} onClick={() => setDialogOpen(true)}>{t("viewer.overlay.newSignature")}</Button>
            </div>
            <span className="text-xs text-muted-foreground">{signature ? (placement ? t("viewer.overlay.signatureMove") : t("viewer.overlay.signatureHint")) : t("viewer.overlay.pickSignature")}</span>
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("viewer.overlay.width")}
              <input type="range" min={10} max={200} value={signatureWidthMm} onChange={(event) => store.setSignatureWidthMm(Number(event.target.value))} className="w-28 accent-primary" aria-label={t("viewer.overlay.width")} />
              <span className="w-12 font-mono tabular-nums">{signatureWidthMm} mm</span>
            </label>
            <Button size="sm" variant="primary" onClick={() => void applySignature()} disabled={!signature || !placement || busy} loading={busy}>{t("viewer.overlay.applySignature")}</Button>
          </>
        ) : null}
        {mode === "text" || mode === "image" ? (
          <>
            {mode === "text" ? <Type className="size-4 text-primary" aria-hidden /> : <ImagePlus className="size-4 text-primary" aria-hidden />}
            {mode === "text" ? (
              <span className="min-w-0 max-w-[30rem] truncate text-xs text-muted-foreground" title={t("viewer.overlay.textHint")}>{t("viewer.overlay.textHint")}</span>
            ) : (
              <>
                <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void pickImage()} disabled={busy}>{t("viewer.overlay.pickImage")}</Button>
                {DRAWING_KINDS.map((kind) => {
                  const { icon: Icon, labels } = DRAWING_SPECS[kind];
                  return (
                    <Button key={kind} size="sm" icon={<Icon className="size-4" aria-hidden />} onClick={() => store.openDrawingEditor(kind, null)} disabled={busy}>
                      {t(labels.pick)}
                    </Button>
                  );
                })}
                {pendingImage ? <img src={pendingImage.dataUrl} alt="" className={pendingImage.drawing ? "h-7 max-w-24 rounded border bg-white object-contain px-1" : "h-7 max-w-16 rounded border object-contain"} draggable={false} /> : null}
                <span className="text-xs text-muted-foreground">{pendingImage ? (pendingImage.drawing ? t(DRAWING_SPECS[pendingImage.drawing.kind].labels.placeHint) : t("viewer.overlay.imageHint")) : t("viewer.overlay.imagePick")}</span>
              </>
            )}
            <span className="flex-1" />
            {selected ? (
              <IconButton
                icon={Trash2}
                label={(selected.kind === "edit" || selected.kind === "block") && selected.text !== "" ? t("viewer.overlay.deleteText") : selected.kind === "imageChange" && !selected.deleted ? t("viewer.overlay.deleteImage") : t("viewer.overlay.deleteObject")}
                onClick={() => {
                  store.snapshot();
                  if ((selected.kind === "edit" || selected.kind === "block") && selected.text !== "") store.updateObject(selected.id, { text: "" });
                  else if (selected.kind === "imageChange" && !selected.deleted) store.updateObject(selected.id, { deleted: true });
                  else store.removeObject(selected.id);
                }}
              />
            ) : null}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{t("viewer.overlay.pending", { count: pendingCount })}</span>
            <Button size="sm" variant="primary" icon={<Save className="size-4" aria-hidden />} onClick={() => void saveEdits(true)} disabled={pendingCount === 0 || busy} loading={busy}>{t("viewer.overlay.save")}</Button>
            <Button size="sm" icon={<SaveAll className="size-4" aria-hidden />} onClick={() => void saveEdits(false)} disabled={pendingCount === 0 || busy}>{t("viewer.overlay.saveAs")}</Button>
          </>
        ) : null}
        <IconButton icon={X} label={t("common.close")} onClick={() => store.requestLeave(close, pendingCount > 0)} />
      </div>
      <SignatureDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onPick={(id) => store.setSignatureId(id)} />
      <DrawingEditorHost />
      <Dialog
        open={leaveNext !== null}
        title={t("viewer.overlay.confirmDiscardTitle")}
        onClose={() => store.cancelLeave()}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => store.cancelLeave()}>{t("common.cancel")}</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                const next = leaveNext;
                store.cancelLeave();
                store.clearObjects();
                next?.();
              }}
            >
              {t("viewer.overlay.confirmDiscardDiscard")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                store.cancelLeave();
                void saveEdits(true);
              }}
              disabled={busy}
              loading={busy}
            >
              {t("viewer.overlay.save")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("viewer.overlay.confirmDiscardBody", { count: pendingCount })}</p>
      </Dialog>
    </>
  );
}
