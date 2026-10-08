import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ClipboardCopy, Copy, FlipHorizontal2, FlipVertical2, ImageUp, Italic, Minus, Plus, RotateCcw, RotateCw, SlidersHorizontal, Trash2, Type, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { FontPicker } from "@/components/shared/FontPicker";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore, type BlockAlign, type EditorPending, type ImageRotation } from "@/shared/store/viewerOverlayStore";
import { DRAWING_SPECS } from "./drawing/drawingKinds";
import { copyEditorObject } from "./editorPaste";
import { isDrawingImage, isDrawingKind, type DrawingImage } from "./drawing/drawingSource";
import { formulaDataUrl } from "./formula/formulaSvg";
import { ImageAltButton } from "./ImageAltButton";
import { replaceImageWithDialog, type ImageChangePending } from "./imageReplace";
import { applyStyleToRuns } from "./runs";
import { computeToolbarPlacement, type ToolbarRect, type ToolbarSize } from "./toolbarPlacement";

type TextLikePending = Extract<EditorPending, { kind: "text" | "edit" | "block" }>;

const DEFAULT_FONT_ID = "bundled:dejavu-sans";
const ALIGN_ORDER: BlockAlign[] = ["left", "center", "right", "justify"];
const ALIGN_ICONS: Record<BlockAlign, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

function turned(rotation: ImageRotation, delta: 90 | -90): ImageRotation {
  return ((((rotation + delta) % 360) + 360) % 360) as ImageRotation;
}

export function ObjectToolbar({ documentId, item, anchorRect, viewportSize }: { documentId: string; item: EditorPending; anchorRect: ToolbarRect; viewportSize: ToolbarSize }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const store = useViewerOverlayStore.getState();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<ToolbarSize>({ width: 0, height: 40 });
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);

  useLayoutEffect(() => {
    const node = toolbarRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setMeasured((current) => (Math.abs(rect.width - current.width) > 0.5 || Math.abs(rect.height - current.height) > 0.5 ? { width: rect.width, height: rect.height } : current));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const placement = computeToolbarPlacement(anchorRect, measured.width ? measured : { width: 260, height: 40 }, viewportSize, 8);

  const duplicate = () => store.duplicateObject(documentId, item);
  const copyToClipboard = () => {
    const outcome = copyEditorObject(documentId, item, false);
    toast("info", outcome === "copied" ? t("viewer.overlay.copied") : t("viewer.overlay.copyUnavailable"));
  };

  const replaceImage = (target: ImageChangePending) => {
    replaceImageWithDialog(target, t).catch((caught) => toast("error", describeError(t, toRpcError(caught))));
  };

  const remove = () => {
    store.snapshot();
    if ((item.kind === "edit" || item.kind === "block") && item.text !== "") store.updateObject(item.id, { text: "" });
    else if (item.kind === "imageChange" && !item.deleted) store.updateObject(item.id, { deleted: true });
    else store.removeObject(item.id);
  };

  const deleteLabel = item.kind === "edit" || item.kind === "block" ? t("viewer.overlay.deleteText") : item.kind === "imageChange" ? t("viewer.overlay.deleteImage") : t("viewer.overlay.deleteObject");

  const opacityButton = (
    <span className="relative">
      <IconButton icon={SlidersHorizontal} label={t("viewer.editPanel.opacity")} active={opacityOpen} onClick={() => setOpacityOpen((value) => !value)} />
      {opacityOpen ? (
        <div role="dialog" aria-label={t("viewer.editPanel.opacity")} className="glass-menu absolute start-0 top-9 z-50 flex w-40 items-center gap-2 rounded-lg p-2">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(item.opacity * 100)}
            onPointerDown={() => store.snapshot()}
            onChange={(event) => store.updateObject(item.id, { opacity: Number(event.target.value) / 100 })}
            className="flex-1 accent-primary"
            aria-label={t("viewer.editPanel.opacity")}
          />
          <span className="w-9 text-end font-mono text-xs tabular-nums">{Math.round(item.opacity * 100)}%</span>
        </div>
      ) : null}
    </span>
  );

  const renderImageChange = (imageChange: ImageChangePending) => {
    const rotateImage = (delta: 90 | -90) => {
      const rotate = turned(imageChange.rotate, delta);
      const swap = (rotate === 90 || rotate === 270) !== (imageChange.rotate === 90 || imageChange.rotate === 270);
      store.snapshot();
      store.updateObject(imageChange.id, swap ? { rotate, width: imageChange.height, height: imageChange.width, aspect: 1 / imageChange.aspect } : { rotate });
    };
    const resetImage = () => {
      store.snapshot();
      store.updateObject(imageChange.id, { ...imageChange.original, rotate: 0, flipH: false, flipV: false, opacity: 1, replacement: null, aspect: imageChange.original.width / imageChange.original.height, aspectLocked: true });
    };
    return (
      <>
        <IconButton icon={ImageUp} label={t("viewer.editPanel.replaceImage")} onClick={() => replaceImage(imageChange)} />
        <IconButton icon={RotateCcw} label={t("viewer.editPanel.rotateLeft")} onClick={() => rotateImage(-90)} />
        <IconButton icon={RotateCw} label={t("viewer.editPanel.rotateRight")} onClick={() => rotateImage(90)} />
        <IconButton icon={FlipHorizontal2} label={t("viewer.editPanel.flipH")} active={imageChange.flipH} onClick={() => { store.snapshot(); store.updateObject(imageChange.id, { flipH: !imageChange.flipH }); }} />
        <IconButton icon={FlipVertical2} label={t("viewer.editPanel.flipV")} active={imageChange.flipV} onClick={() => { store.snapshot(); store.updateObject(imageChange.id, { flipV: !imageChange.flipV }); }} />
        {opacityButton}
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Copy} label={t("viewer.overlay.duplicate")} onClick={duplicate} />
        <IconButton icon={ClipboardCopy} label={t("viewer.overlay.copyObject")} shortcut="Ctrl+C" onClick={copyToClipboard} />
        <IconButton icon={Trash2} label={deleteLabel} onClick={remove} />
        <IconButton icon={Undo2} label={t("viewer.overlay.reset")} onClick={resetImage} />
      </>
    );
  };

  const recolorFormula = (formulaImage: DrawingImage<"formula">, color: string) => {
    const formula = { ...formulaImage.drawing.source, color };
    store.snapshot();
    store.updateObject(formulaImage.id, { drawing: { kind: "formula", source: formula }, dataUrl: formulaDataUrl(formula) } as Partial<EditorPending>);
  };

  const drawingEditButton = (drawingImage: DrawingImage) => {
    const { icon, labels } = DRAWING_SPECS[drawingImage.drawing.kind];
    return <IconButton icon={icon} label={t(labels.edit)} onClick={() => store.openDrawingEditor(drawingImage.drawing.kind, drawingImage.id)} />;
  };

  const renderImage = () => (
    <>
      {isDrawingImage(item) ? drawingEditButton(item) : null}
      {isDrawingKind(item, "formula") ? <ColorSwatch value={item.drawing.source.color} onChange={(color) => recolorFormula(item, color)} label={t("viewer.formula.color")} customLabel={t("viewer.overlay.customColor")} /> : null}
      {item.kind === "image" && !isDrawingImage(item) ? <ImageAltButton value={item.alt ?? ""} onBegin={() => store.snapshot()} onChange={(alt) => store.updateObject(item.id, { alt })} /> : null}
      {opacityButton}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <IconButton icon={Copy} label={t("viewer.overlay.duplicate")} onClick={duplicate} />
        <IconButton icon={ClipboardCopy} label={t("viewer.overlay.copyObject")} shortcut="Ctrl+C" onClick={copyToClipboard} />
      <IconButton icon={Trash2} label={deleteLabel} onClick={remove} />
    </>
  );

  const renderTextLike = (textLike: TextLikePending) => {
    const style = textLike.style;
    const hasItalic = textLike.kind === "edit" || textLike.kind === "block";
    const hasJustify = textLike.kind === "block";
    const alignOptions = hasJustify ? ALIGN_ORDER : ALIGN_ORDER.slice(0, 3);
    const align = style.align as BlockAlign;
    const AlignIcon = ALIGN_ICONS[align] ?? AlignLeft;

    const patchStyle = (patch: Record<string, unknown>) => {
      store.snapshot();
      const runsPatch = textLike.kind === "block" ? { runs: applyStyleToRuns(textLike.runs, patch) } : textLike.kind === "text" && textLike.runs ? { runs: applyStyleToRuns(textLike.runs, patch) } : {};
      store.updateObject(textLike.id, { style: { ...style, ...patch }, ...runsPatch } as Partial<EditorPending>);
    };
    const cycleAlign = () => {
      const index = alignOptions.indexOf(align);
      patchStyle({ align: alignOptions[(index + 1) % alignOptions.length] });
    };

    return (
      <>
        <IconButton icon={Bold} label={t("tools.bold")} active={style.bold} onClick={() => patchStyle({ bold: !style.bold })} />
        <IconButton icon={Italic} label={t("viewer.overlay.italic")} active={hasItalic && (style as { italic: boolean }).italic} disabled={!hasItalic} onClick={() => patchStyle({ italic: !(style as { italic: boolean }).italic })} />
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Minus} label={t("viewer.overlay.fontSizeDecrease")} onClick={() => patchStyle({ fontSize: Math.max(1, style.fontSize - 1) })} />
        <IconButton icon={Plus} label={t("viewer.overlay.fontSizeIncrease")} onClick={() => patchStyle({ fontSize: Math.min(400, style.fontSize + 1) })} />
        <ColorSwatch value={style.color} onChange={(color) => patchStyle({ color })} label={t("viewer.overlay.color")} customLabel={t("viewer.overlay.customColor")} />
        <IconButton icon={AlignIcon} label={t("viewer.overlay.alignCycle")} onClick={cycleAlign} />
        {textLike.kind === "text" ? (
          <span className="relative">
            <IconButton icon={Type} label={t("fontPicker.label")} active={fontOpen} onClick={() => setFontOpen((value) => !value)} />
            {fontOpen ? (
              <div role="dialog" aria-label={t("fontPicker.label")} className="glass-menu absolute start-0 top-9 z-50 w-72 rounded-lg p-2">
                <FontPicker value={textLike.style.fontId ?? DEFAULT_FONT_ID} onChange={(fontId) => patchStyle({ fontId })} />
              </div>
            ) : null}
          </span>
        ) : null}
        {opacityButton}
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <IconButton icon={Copy} label={t("viewer.overlay.duplicate")} onClick={duplicate} />
        <IconButton icon={ClipboardCopy} label={t("viewer.overlay.copyObject")} shortcut="Ctrl+C" onClick={copyToClipboard} />
        <IconButton icon={Trash2} label={deleteLabel} onClick={remove} />
      </>
    );
  };

  return createPortal(
    <div ref={toolbarRef} role="toolbar" aria-label={t("viewer.overlay.toolbar")} onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} className="glass-menu fixed z-30 flex items-center gap-1 rounded-xl p-1" style={{ top: placement.top, left: placement.left, visibility: measured.width ? "visible" : "hidden" }}>
      {item.kind === "imageChange" ? renderImageChange(item) : item.kind === "image" ? renderImage() : renderTextLike(item)}
    </div>,
    document.body,
  );
}
