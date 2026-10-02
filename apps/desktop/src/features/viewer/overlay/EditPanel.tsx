import { AlertTriangle, AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, FlipHorizontal2, FlipVertical2, Image as ImageIcon, ImageUp, Info, Italic, Lock, Move, Redo2, RotateCcw, RotateCw, Trash2, Type, Undo2, Unlock } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { editorFontPlan } from "@/shared/rpc/operations";
import { toRpcError } from "@/shared/rpc/client";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore, type BlockAlign, type EditorPending, type ImageRotation } from "@/shared/store/viewerOverlayStore";
import type { EditorWarningCode } from "@/types";
import { applyStyleToRuns, restoreOriginalRunStyles, styleOf, textOf } from "./runs";
import { applyGeometryPatch, formatGeometryValue, parseGeometryValue } from "./geometry";
import { replaceImageWithDialog, type ImageChangePending } from "./imageReplace";
import { LayersPanel } from "./LayersPanel";
import { DRAWING_SPECS } from "./drawing/drawingKinds";
import { isDrawingImage, isDrawingKind } from "./drawing/drawingSource";
import { camelSplit, fontFamilyChoice, fontNameForChoice, isPendingChange, rectChanged, styleUnchanged } from "./pending";

const GEOMETRY_FIELDS = ["x", "y", "width", "height"] as const;
type GeometryField = (typeof GEOMETRY_FIELDS)[number];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64];
const LINE_HEIGHTS = [1, 1.15, 1.2, 1.35, 1.5, 2];

function effectiveLineHeight(block: { leading: number; style: { fontSize: number; lineHeight: number } }): number {
  return block.leading > 0 && block.style.fontSize > 0 ? Math.round((block.leading / block.style.fontSize) * 100) / 100 : block.style.lineHeight;
}
const FONT_PLAN_DEBOUNCE_MS = 300;

function warningKey(code: EditorWarningCode): string {
  return `viewer.editPanel.warning${code[0].toUpperCase()}${code.slice(1)}`;
}

function describe(item: EditorPending): string {
  if (isDrawingKind(item, "formula")) return item.drawing.source.latex.replace(/\s+/g, " ").trim().slice(0, 48);
  if (item.kind === "image" || item.kind === "imageChange") return "";
  return (item.text || "").replace(/\s+/g, " ").trim().slice(0, 48);
}

function turned(rotation: ImageRotation, delta: 90 | -90): ImageRotation {
  return (((rotation + delta) % 360) + 360) % 360 as ImageRotation;
}

export function EditPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const objects = useViewerOverlayStore((state) => state.objects);
  const selectedObjectId = useViewerOverlayStore((state) => state.selectedObjectId);
  const textStyle = useViewerOverlayStore((state) => state.textStyle);
  const past = useViewerOverlayStore((state) => state.past);
  const future = useViewerOverlayStore((state) => state.future);
  const warnings = useViewerOverlayStore((state) => state.warnings);
  const fontResolutions = useViewerOverlayStore((state) => state.fontResolutions);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const store = useViewerOverlayStore.getState();
  const selected = objects.find((item) => item.id === selectedObjectId) ?? null;
  const pending = objects.filter(isPendingChange);
  const textLike = selected && (selected.kind === "text" || selected.kind === "block") ? selected : null;
  const block = textLike?.kind === "block" ? textLike : null;
  const imageChange = selected?.kind === "imageChange" ? selected : null;
  const style = textLike ? textLike.style : textStyle;
  const align: BlockAlign = style.align;
  const lineHeight = block ? effectiveLineHeight(block) : 1.2;
  const lineHeights = [...new Set([...LINE_HEIGHTS, lineHeight])].sort((a, b) => a - b);
  const originalFontLabel = block?.fontFamily ? t("viewer.editPanel.fontOriginalNamed", { name: camelSplit(block.fontFamily) }) : t("viewer.editPanel.fontAuto");
  const fontPlanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fontPlanTimer.current) clearTimeout(fontPlanTimer.current);
    if (!block || !document) return;
    const text = textOf(block.runs) || block.text || " ";
    fontPlanTimer.current = setTimeout(() => {
      void editorFontPlan({
        path: document.path,
        password: document.password ?? undefined,
        page: block.pageIndex,
        fontXref: block.fontXref || undefined,
        fontFamily: block.style.font ?? undefined,
        bold: block.style.bold,
        italic: block.style.italic,
        text,
      })
        .then((resolution) => useViewerOverlayStore.getState().setFontResolution(block.id, resolution))
        .catch(() => undefined);
    }, FONT_PLAN_DEBOUNCE_MS);
    return () => {
      if (fontPlanTimer.current) clearTimeout(fontPlanTimer.current);
    };
  }, [block, document]);

  const fontResolution = block ? fontResolutions[block.id] : null;
  const fontResolutionIsOriginal = fontResolution ? fontResolution.source === "embedded" && fontResolution.family === block?.fontFamily : true;

  const sizeOptions = [...new Set([...FONT_SIZES, style.fontSize])].sort((a, b) => a - b).map((size) => ({ value: String(size), label: `${Number.isInteger(size) ? size : size.toFixed(1)} pt` }));

  const setLineHeight = (value: number) => {
    if (!block) return;
    store.snapshot();
    store.updateObject(block.id, { style: { ...block.style, lineHeight: value }, leading: 0 });
  };
  const patchStyle = (patch: Record<string, unknown>) => {
    if (block) {
      store.snapshot();
      store.updateObject(block.id, { style: { ...block.style, ...patch }, runs: applyStyleToRuns(block.runs, patch) });
      return;
    }
    if (selected && (selected.kind === "text" || selected.kind === "edit")) store.snapshot();
    store.setTextStyle(patch);
  };

  const revert = (item: EditorPending) => {
    store.snapshot();
    store.removeObject(item.id);
  };

  const patchImage = (item: ImageChangePending, patch: Partial<ImageChangePending>) => {
    store.snapshot();
    store.updateObject(item.id, patch);
  };

  const replaceImage = async (item: ImageChangePending) => {
    try {
      await replaceImageWithDialog(item, t);
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    }
  };

  const rotateImage = (item: ImageChangePending, delta: 90 | -90) => {
    const rotate = turned(item.rotate, delta);
    const swap = (rotate === 90 || rotate === 270) !== (item.rotate === 90 || item.rotate === 270);
    patchImage(item, swap ? { rotate, width: item.height, height: item.width, aspect: 1 / item.aspect } : { rotate });
  };

  const commitGeometry = (field: GeometryField, raw: string) => {
    if (!selected) return;
    const value = parseGeometryValue(raw);
    if (value === null) return;
    const rect = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
    const aspectLocked = selected.kind === "imageChange" && selected.aspectLocked;
    const aspect = selected.kind === "imageChange" || selected.kind === "image" ? selected.aspect : 1;
    const patch = applyGeometryPatch(rect, field, value, aspectLocked, aspect);
    store.snapshot();
    store.updateObject(selected.id, patch as Partial<EditorPending>);
  };

  const aligns: Array<{ value: BlockAlign; icon: typeof AlignLeft }> = [
    { value: "left", icon: AlignLeft },
    { value: "center", icon: AlignCenter },
    { value: "right", icon: AlignRight },
    { value: "justify", icon: AlignJustify },
  ];

  const changeLabel = (item: EditorPending): string => {
    if (item.kind === "imageChange") {
      if (item.deleted) return t("viewer.editPanel.imageDeleted");
      if (item.replacement) return t("viewer.editPanel.imageReplaced");
      if (rectChanged(item)) return t("viewer.editPanel.imageMoved");
      return t("viewer.editPanel.imageTurned");
    }
    if (isDrawingImage(item)) return t(DRAWING_SPECS[item.drawing.kind].labels.added);
    if (item.kind === "image") return t("viewer.editPanel.imageAdded");
    if (item.kind === "block") {
      if (item.text === "") return t("viewer.editPanel.textDeleted");
      if (item.text === item.original && styleUnchanged(item)) return t("viewer.editPanel.textMoved");
      return t("viewer.editPanel.textChanged");
    }
    return t("viewer.editPanel.textAdded");
  };

  return (
    <aside className="glass-flat flex h-full w-72 shrink-0 flex-col border-s" aria-label={t("viewer.editPanel.title")} data-document={documentId}>
      <div className="flex h-11 items-center gap-1 border-b px-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("viewer.editPanel.title")}</span>
        <span className="flex-1" />
        <IconButton icon={Undo2} label={t("viewer.editPanel.undo")} disabled={past.length === 0} onClick={() => store.undo()} />
        <IconButton icon={Redo2} label={t("viewer.editPanel.redo")} disabled={future.length === 0} onClick={() => store.redo()} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LayersPanel documentId={documentId} />
        {imageChange ? (
          <section className="border-b px-3 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <ImageIcon className="size-3.5 text-primary" aria-hidden />
              {t("viewer.editPanel.image")}
            </p>
            <Button size="sm" icon={<ImageUp className="size-4" aria-hidden />} onClick={() => void replaceImage(imageChange)} disabled={imageChange.deleted} className="w-full justify-start">
              {t("viewer.editPanel.replaceImage")}
            </Button>
            <div className="mt-2 flex items-center gap-1">
              <IconButton icon={RotateCcw} label={t("viewer.editPanel.rotateLeft")} disabled={imageChange.deleted} onClick={() => rotateImage(imageChange, -90)} />
              <IconButton icon={RotateCw} label={t("viewer.editPanel.rotateRight")} disabled={imageChange.deleted} onClick={() => rotateImage(imageChange, 90)} />
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
              <IconButton icon={FlipHorizontal2} label={t("viewer.editPanel.flipH")} active={imageChange.flipH} disabled={imageChange.deleted} onClick={() => patchImage(imageChange, { flipH: !imageChange.flipH })} />
              <IconButton icon={FlipVertical2} label={t("viewer.editPanel.flipV")} active={imageChange.flipV} disabled={imageChange.deleted} onClick={() => patchImage(imageChange, { flipV: !imageChange.flipV })} />
              <span className="flex-1" />
              <IconButton
                icon={imageChange.deleted ? RotateCcw : Trash2}
                label={imageChange.deleted ? t("viewer.editPanel.restoreImage") : t("viewer.overlay.deleteImage")}
                onClick={() => patchImage(imageChange, { deleted: !imageChange.deleted })}
              />
            </div>
          </section>
        ) : null}
        {selected ? (
          <section className="border-b px-3 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Move className="size-3.5 text-primary" aria-hidden />
              <span className="flex-1">{t("viewer.editPanel.geometry")}</span>
              {selected.kind === "imageChange" ? (
                <IconButton
                  icon={selected.aspectLocked ? Lock : Unlock}
                  label={t("viewer.editPanel.aspectLock")}
                  active={selected.aspectLocked}
                  onClick={() => store.updateObject(selected.id, { aspectLocked: !selected.aspectLocked })}
                />
              ) : null}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {GEOMETRY_FIELDS.map((field) => {
                const fieldName = `${field[0].toUpperCase()}${field.slice(1)}`;
                const fullLabel = t(`viewer.editPanel.geometry${fieldName}Full`);
                return (
                <label key={field} title={fullLabel} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {t(`viewer.editPanel.geometry${fieldName}`)}
                  <input
                    key={`${selected.id}-${field}-${formatGeometryValue(selected[field])}`}
                    type="text"
                    inputMode="decimal"
                    defaultValue={formatGeometryValue(selected[field])}
                    className="h-7 w-full rounded-md border bg-background px-1.5 font-mono text-xs"
                    aria-label={fullLabel}
                    onBlur={(event) => commitGeometry(field, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>
                );
              })}
            </div>
            <label title={t("viewer.editPanel.opacity")} className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {t("viewer.editPanel.opacity")}
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(selected.opacity * 100)}
                onPointerDown={() => store.snapshot()}
                onChange={(event) => store.updateObject(selected.id, { opacity: Number(event.target.value) / 100 })}
                className="flex-1 accent-primary"
                aria-label={t("viewer.editPanel.opacity")}
              />
              <span className="w-9 text-end font-mono tabular-nums">{Math.round(selected.opacity * 100)}%</span>
            </label>
          </section>
        ) : null}
        <section className="border-b px-3 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <Type className="size-3.5 text-primary" aria-hidden />
            <span className="flex-1">{textLike ? (block ? t("viewer.editPanel.existingText") : t("viewer.editPanel.newText")) : t("viewer.editPanel.defaults")}</span>
            {block && !styleUnchanged(block) ? (
              <IconButton
                icon={RotateCcw}
                label={t("viewer.editPanel.resetStyle")}
                onClick={() => {
                  store.snapshot();
                  const fallback = block.originalRuns.length > 0 ? styleOf(block.originalRuns[0]) : { font: block.originalStyle.font, fontXref: block.fontXref, size: block.originalStyle.fontSize, color: block.originalStyle.color, bold: block.originalStyle.bold, italic: block.originalStyle.italic, superscript: false };
                  store.updateObject(block.id, { style: { ...block.originalStyle }, runs: restoreOriginalRunStyles(block.runs, block.originalRuns, fallback) });
                }}
              />
            ) : null}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              size="sm"
              value={block ? fontFamilyChoice(block.style.font, block.originalStyle.font) : "auto"}
              options={[
                { value: "auto", label: originalFontLabel },
                { value: "sans", label: "Sans" },
                { value: "serif", label: "Serif" },
                { value: "mono", label: "Mono" },
              ]}
              onChange={(value) => patchStyle({ font: fontNameForChoice(value as "auto" | "sans" | "serif" | "mono", block?.originalStyle.font ?? null) })}
              disabled={!block}
              ariaLabel={t("viewer.editPanel.font")}
            />
            <Select size="sm" mono value={String(style.fontSize)} options={sizeOptions} onChange={(value) => patchStyle({ fontSize: Number(value) })} ariaLabel={t("viewer.overlay.fontSize")} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            <ColorSwatch value={style.color} onChange={(color) => patchStyle({ color })} label={t("viewer.overlay.color")} customLabel={t("viewer.overlay.customColor")} />
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <IconButton icon={Bold} label={t("tools.bold")} active={style.bold} onClick={() => patchStyle({ bold: !style.bold })} />
            <IconButton icon={Italic} label={t("viewer.overlay.italic")} active={block ? block.style.italic : false} disabled={!block} onClick={() => patchStyle({ italic: !(block && block.style.italic) })} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            {aligns.map(({ value, icon: Icon }) => (
              <IconButton key={value} icon={Icon} label={t(`viewer.overlay.align.${value}`)} active={align === value} disabled={value === "justify" && !block} onClick={() => patchStyle({ align: value })} />
            ))}
            <span className="flex-1" />
            <Select size="sm" mono value={String(lineHeight)} options={lineHeights.map((value) => ({ value: String(value), label: `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×` }))} onChange={(value) => setLineHeight(Number(value))} disabled={!block} ariaLabel={t("viewer.editPanel.lineHeight")} className="w-20" />
          </div>
          {block && fontResolution ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              {!fontResolutionIsOriginal ? <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden /> : null}
              {t("viewer.editPanel.fontPlan", { family: camelSplit(fontResolution.family), source: t(`viewer.editPanel.fontSource${fontResolution.source[0].toUpperCase()}${fontResolution.source.slice(1)}`) })}
            </p>
          ) : null}
          {block && block.fittedSize !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("viewer.editPanel.fittedSize", { size: block.fittedSize })}</p>
          ) : null}
        </section>
        {warnings.length > 0 ? (
          <section className="border-b px-3 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              {t("viewer.editPanel.warnings")}
            </p>
            <ul className="space-y-1">
              {warnings.map((warning, index) => (
                <li key={`${warning.objectId}-${warning.code}-${index}`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  {warning.severity === "info" ? <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />}
                  <span>{t(warningKey(warning.code), { detail: warning.detail })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="px-3 py-3">
          <p className="mb-2 text-xs font-medium">{t("viewer.editPanel.changes", { count: pending.length })}</p>
          {pending.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("viewer.editPanel.noChanges")}</p>
          ) : (
            <ul className="space-y-1">
              {pending.map((item) => {
                const Icon = isDrawingImage(item) ? DRAWING_SPECS[item.drawing.kind].icon : item.kind === "image" || item.kind === "imageChange" ? ImageIcon : Type;
                return (
                  <li key={item.id} className={cn("nav-glass flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs", selectedObjectId === item.id && "glass-chip")}>
                    <button type="button" onClick={() => store.setSelectedObject(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span title={`${changeLabel(item)} · ${t("viewer.editPanel.page", { page: item.pageIndex + 1 })}`} className="block truncate">{changeLabel(item)} · {t("viewer.editPanel.page", { page: item.pageIndex + 1 })}</span>
                        {describe(item) ? <span title={describe(item)} className="block truncate text-muted-foreground">{describe(item)}</span> : null}
                      </span>
                    </button>
                    <IconButton icon={item.kind === "block" || item.kind === "imageChange" ? RotateCcw : Trash2} label={t("viewer.editPanel.revert")} onClick={() => revert(item)} className="size-6" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
