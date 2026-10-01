import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, Section, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { withinRange } from "@/shared/lib/numberRange";
import { renderThumbnail, thumbnailDataUrl } from "@/shared/rpc/thumbnail";
import type { TextEdit, TextSpan } from "@/types";
import { TEXT_EDIT_SIZE } from "./textEditState";

const PREVIEW_MAX_WIDTH = 720;
const RENDER_WIDTH = 1440;
const BACKGROUND_CACHE_LIMIT = 8;
const backgroundCache = new Map<string, string>();

function rememberBackground(key: string, url: string) {
  backgroundCache.delete(key);
  backgroundCache.set(key, url);
  while (backgroundCache.size > BACKGROUND_CACHE_LIMIT) {
    const oldest = backgroundCache.keys().next().value;
    if (oldest === undefined) break;
    backgroundCache.delete(oldest);
  }
}

type TextEditTabProps = {
  sourcePath: string | null;
  password: string | null;
  page: number;
  pageCount: number;
  onPageChange: (value: number) => void;
  loading: boolean;
  size: { width: number; height: number } | null;
  spans: TextSpan[];
  edits: Map<string, TextEdit>;
  activeId: string | null;
  onSelectSpan: (id: string | null) => void;
  onEditChange: (span: TextSpan, patch: Partial<TextEdit>) => void;
  onRemoveEdit: (id: string) => void;
  disabled: boolean;
};

function measureTextWidth(text: string, font: string): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  context.font = font;
  return context.measureText(text).width;
}

function useContainerWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.min(PREVIEW_MAX_WIDTH, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function usePageBackground(sourcePath: string | null, password: string | null, page: number): string | null {
  const [background, setBackground] = useState<string | null>(null);
  useEffect(() => {
    if (!sourcePath) {
      setBackground(null);
      return;
    }
    const key = `${sourcePath}::${page}`;
    const cached = backgroundCache.get(key);
    if (cached) {
      rememberBackground(key, cached);
      setBackground(cached);
      return;
    }
    let cancelled = false;
    setBackground(null);
    renderThumbnail({ path: sourcePath, password: password ?? undefined, page: page - 1, width: RENDER_WIDTH })
      .then((result) => {
        const url = thumbnailDataUrl(result);
        rememberBackground(key, url);
        if (!cancelled) setBackground(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sourcePath, password, page]);
  return background;
}

function SpanOverlay({ span, edit, active, scale, onSelect }: { span: TextSpan; edit: TextEdit | undefined; active: boolean; scale: number; onSelect: () => void }) {
  const [x0, y0, x1, y1] = span.bbox;
  const width = (x1 - x0) * scale;
  const height = (y1 - y0) * scale;
  const fontSize = Math.max(6, (edit?.size ?? span.size) * scale);
  const weight = (edit?.bold ?? span.bold) ? 700 : 400;
  const style = (edit?.italic ?? span.italic) ? "italic" : "normal";
  const text = edit?.text ?? span.text;
  const fit = useMemo(() => {
    if (!edit) return 1;
    const measured = measureTextWidth(text, `${style} ${weight} ${fontSize}px "Geist Variable", system-ui, sans-serif`);
    return measured > 0 ? Math.min(1, (width - 4) / measured) : 1;
  }, [edit, text, style, weight, fontSize, width]);

  return (
    <button
      type="button"
      onClick={onSelect}
      title={text}
      className={cn(
        "absolute rounded-[2px] border text-start leading-none outline-none transition-[box-shadow,border-color] duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
        edit ? "border-primary/60 bg-card" : "border-transparent hover:border-primary/60 hover:bg-primary/10",
        active && "shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]",
      )}
      style={{ left: x0 * scale, top: y0 * scale, width, height }}
    >
      {edit ? (
        <span
          className="absolute inset-y-0 start-0.5 flex items-center whitespace-nowrap"
          style={{ fontSize, color: edit.color ?? span.color, fontWeight: weight, fontStyle: style, transform: `scaleX(${fit})`, transformOrigin: "left center" }}
        >
          {text}
        </span>
      ) : null}
    </button>
  );
}

export function TextEditTab({
  sourcePath,
  password,
  page,
  pageCount,
  onPageChange,
  loading,
  size,
  spans,
  edits,
  activeId,
  onSelectSpan,
  onEditChange,
  onRemoveEdit,
  disabled,
}: TextEditTabProps) {
  const { t } = useTranslation();
  const [containerRef, containerWidth] = useContainerWidth();
  const background = usePageBackground(sourcePath, password, page);
  const scale = size && containerWidth ? containerWidth / size.width : 1;
  const canvasHeight = size ? size.height * scale : 0;
  const activeSpan = useMemo(() => spans.find((span) => span.id === activeId) ?? null, [spans, activeId]);
  const activeEdit = activeSpan ? edits.get(activeSpan.id) : undefined;
  const activeSize = activeEdit?.size ?? activeSpan?.size ?? TEXT_EDIT_SIZE.min;
  const activeSizeValid = withinRange(activeSize, TEXT_EDIT_SIZE);

  return (
    <Section title={t("tools.edit.textedit.title")}>
      <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{t("tools.edit.textedit.warning")}</p>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t("tools.edit.textedit.page")}>
          <TextInput
            type="number"
            min={1}
            max={pageCount || 1}
            value={page}
            onChange={(event) => onPageChange(Math.min(Math.max(1, Number(event.target.value)), pageCount || 1))}
            className="w-24 font-mono"
            disabled={disabled}
          />
        </Field>
        <p className="pb-2 text-xs text-muted-foreground">{t("tools.edit.textedit.hint", { count: spans.length })}</p>
      </div>
      <div className={cn("grid gap-4", activeSpan ? "grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-1")}>
        <div ref={containerRef} className="min-w-0">
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
          ) : size ? (
            <div className="overflow-hidden rounded-lg border bg-white shadow-(--shadow-card)" style={{ width: containerWidth || undefined }}>
              <div
                className="relative"
                style={{
                  width: containerWidth || undefined,
                  height: canvasHeight,
                  backgroundImage: background ? `url(${background})` : undefined,
                  backgroundSize: "100% 100%",
                }}
              >
                {!background ? <div className="absolute inset-0 animate-pulse bg-muted/40" /> : null}
                {spans.map((span) => (
                  <SpanOverlay key={span.id} span={span} edit={edits.get(span.id)} active={activeId === span.id} scale={scale} onSelect={() => onSelectSpan(span.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {activeSpan ? (
          <div className="glass self-start space-y-3 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("tools.edit.textedit.editSpan")}</span>
              <IconButton icon={X} label={t("common.close")} onClick={() => onSelectSpan(null)} />
            </div>
            <Field label={t("tools.edit.textedit.text")}>
              <TextInput value={activeEdit?.text ?? activeSpan.text} onChange={(event) => onEditChange(activeSpan, { text: event.target.value })} disabled={disabled} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tools.fontSize")} hint={activeSizeValid ? undefined : t("tools.outOfRange", TEXT_EDIT_SIZE)}>
                <TextInput
                  type="number"
                  min={TEXT_EDIT_SIZE.min}
                  max={TEXT_EDIT_SIZE.max}
                  step="any"
                  value={Number.isFinite(activeSize) ? activeSize : ""}
                  onChange={(event) => onEditChange(activeSpan, { size: event.target.valueAsNumber })}
                  aria-invalid={!activeSizeValid || undefined}
                  className="font-mono"
                  disabled={disabled}
                />
              </Field>
              <Field label={t("tools.color")}>
                <ColorSwatch
                  value={activeEdit?.color ?? activeSpan.color}
                  onChange={(color) => onEditChange(activeSpan, { color })}
                  label={t("tools.color")}
                  customLabel={t("colorPicker.custom")}
                  disabled={disabled}
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox label={t("tools.bold")} checked={activeEdit?.bold ?? activeSpan.bold} onChange={(checked) => onEditChange(activeSpan, { bold: checked })} disabled={disabled} />
              <Checkbox label={t("tools.edit.textedit.italic")} checked={activeEdit?.italic ?? activeSpan.italic} onChange={(checked) => onEditChange(activeSpan, { italic: checked })} disabled={disabled} />
            </div>
            {activeEdit ? (
              <Button size="sm" variant="ghost" onClick={() => onRemoveEdit(activeSpan.id)} disabled={disabled}>
                {t("tools.edit.textedit.revert")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {edits.size > 0 ? (
        <ul className="space-y-1.5">
          {Array.from(edits.entries()).map(([id, edit]) => (
            <li key={id} className="flex h-8 items-center gap-2 rounded-md border bg-secondary px-2 text-sm">
              <span title={edit.text} className="min-w-0 flex-1 truncate font-mono text-xs">
                {edit.text}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onSelectSpan(id)} disabled={disabled}>
                {t("tools.edit.textedit.editSpan")}
              </Button>
              <IconButton icon={X} label={t("common.delete")} onClick={() => onRemoveEdit(id)} disabled={disabled} />
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
