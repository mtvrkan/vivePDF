import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Check, ChevronLeft, ChevronRight, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { Field, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import type { OrganizerSource, OrganizerTile, PageLabelStyle } from "@/types";
import { MAIN_SOURCE_ID } from "./organizerStore";
import { formatLabel, type TileLabel } from "./organizerTools";
import { PageThumbnail } from "./PageThumbnail";
import { parseRanges } from "./useInsertSources";

const PREVIEW_WIDTH = 820;

type PreviewProps = {
  tile: OrganizerTile | null;
  position: number;
  total: number;
  label: string | null;
  sources: Record<string, OrganizerSource>;
  selected: boolean;
  selectedCount: number;
  onClose: () => void;
  onStep: (delta: number, extend: boolean) => void;
  onRotate: (delta: 90 | -90) => void;
  onToggleSelect: () => void;
  onOpenInViewer: (() => void) | null;
};

function pressesOtherButton(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest("button, a[href], [role='button']");
  return control !== null && !control.hasAttribute("data-preview-select");
}

export function PagePreviewDialog({ tile, position, total, label, sources, selected, selectedCount, onClose, onStep, onRotate, onToggleSelect, onOpenInViewer }: PreviewProps) {
  const { t } = useTranslation();
  const open = tile !== null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        onStep(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
      } else if (event.key === " ") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && !event.shiftKey && !event.repeat && !pressesOtherButton(event.target)) {
        event.preventDefault();
        onToggleSelect();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        onRotate(event.shiftKey ? -90 : 90);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onStep, onRotate, onToggleSelect]);

  if (!tile) return null;
  const origin =
    tile.kind === "page"
      ? tile.sourceId === MAIN_SOURCE_ID
        ? t("tools.pages.preview.originalPage", { page: tile.index })
        : `${sources[tile.sourceId]?.fileName ?? ""} · ${tile.index}`
      : tile.kind === "blank"
        ? t(tile.paper ? `tools.pages.paper.${tile.paper.style}` : "tools.pages.blank")
        : tile.fileName;

  return (
    <Dialog open title={t("tools.pages.preview.title", { page: position + 1, total })} onClose={onClose} size="xl">
      <div data-testid="page-preview" className="space-y-3">
        <PageThumbnail
          tile={tile}
          sources={sources}
          width={PREVIEW_WIDTH}
          height={Math.round(window.innerHeight * 0.62)}
          className="rounded-lg"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-keyshortcuts="Enter"
            title={`${t("tools.pages.preview.select")} (Enter)`}
            data-preview-select=""
            onClick={onToggleSelect}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm font-medium outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "border-primary bg-primary/10 text-foreground" : "bg-card text-foreground/80 hover:border-primary/40 hover:text-foreground",
            )}
          >
            <span aria-hidden className={cn("flex size-5 items-center justify-center rounded-md border", selected ? "border-primary bg-primary text-primary-foreground" : "bg-card text-transparent")}>
              <Check className="size-3.5" />
            </span>
            {t("tools.pages.preview.select")}
          </button>
          <span role="status" className="text-xs text-muted-foreground tabular-nums">
            {t("tools.pages.selectedCount", { count: selectedCount })}
          </span>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <IconButton icon={ChevronLeft} label={t("tools.pages.preview.previous")} shortcut="← / Shift+←" disabled={position === 0} onClick={(event) => onStep(-1, event.shiftKey)} />
          <IconButton icon={ChevronRight} label={t("tools.pages.preview.next")} shortcut="→ / Shift+→" disabled={position >= total - 1} onClick={(event) => onStep(1, event.shiftKey)} />
          <IconButton icon={RotateCcw} label={t("tools.pages.rotateLeft")} shortcut="Shift+R" onClick={() => onRotate(-90)} />
          <IconButton icon={RotateCw} label={t("tools.pages.rotateRight")} shortcut="R" onClick={() => onRotate(90)} />
          {onOpenInViewer ? <IconButton icon={BookOpen} label={t("tools.pages.menu.openInViewer")} onClick={onOpenInViewer} /> : null}
          <p className="min-w-0 flex-1 truncate text-end text-sm text-muted-foreground">
            {origin}
            {label ? ` · ${t("tools.pages.labels.shown", { label })}` : ""}
            {tile.rotate ? ` · ${tile.rotate}°` : ""}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t("tools.pages.preview.hint")}</p>
      </div>
    </Dialog>
  );
}

type RangeProps = { open: boolean; total: number; onClose: () => void; onSelect: (positions: number[]) => void };

export function RangeSelectDialog({ open, total, onClose, onSelect }: RangeProps) {
  const { t } = useTranslation();
  const [spec, setSpec] = useState("");

  useEffect(() => {
    if (open) setSpec("");
  }, [open]);

  const positions = spec.trim() ? parseRanges(spec, total) : null;
  const invalid = spec.trim() !== "" && positions === null;
  const count = positions ? new Set(positions).size : 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (positions && positions.length > 0) onSelect(positions);
  };

  return (
    <Dialog open={open} title={t("tools.pages.range.title")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("tools.pages.range.label", { total })} hint={t("tools.pages.range.hint")}>
          <TextInput autoFocus value={spec} onChange={(event) => setSpec(event.target.value)} placeholder="1-5, 9, 12-" className="font-mono" aria-invalid={invalid || undefined} />
        </Field>
        <p role="status" className={invalid ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {invalid ? t("tools.pages.invalidRange") : t("tools.pages.selectedCount", { count })}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={count === 0}>{t("tools.pages.range.select")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

type MoveProps = { open: boolean; total: number; count: number; onClose: () => void; onMove: (position: number) => void };

export function MovePagesDialog({ open, total, count, onClose, onMove }: MoveProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const position = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(position) && position >= 1 && position <= total;
  const invalid = value.trim() !== "" && !valid;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onMove(position);
  };

  return (
    <Dialog open={open} title={t("tools.pages.move.title")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("tools.pages.move.label", { total })} hint={t("tools.pages.move.hint", { count })}>
          <TextInput autoFocus type="number" min={1} max={total} value={value} onChange={(event) => setValue(event.target.value)} className="w-32 font-mono" aria-invalid={invalid || undefined} />
        </Field>
        {invalid ? (
          <p role="status" className="text-sm text-destructive">
            {t("tools.pages.move.invalid", { total })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!valid}>{t("tools.pages.move.submit")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export type DuplexChoice = { pad: boolean; reverseBacks: boolean; twoFiles: boolean };

type DuplexProps = { open: boolean; total: number; onClose: () => void; onApply: (choice: DuplexChoice) => void };

function sidesPreview(total: number, choice: DuplexChoice): { fronts: string; backs: string } {
  const count = total % 2 === 1 && choice.pad ? total + 1 : total;
  const name = (position: number) => (position > total ? "□" : String(position));
  const fronts = Array.from({ length: Math.ceil(count / 2) }, (_, index) => name(index * 2 + 1));
  const backs = Array.from({ length: Math.floor(count / 2) }, (_, index) => name(index * 2 + 2));
  if (choice.reverseBacks) backs.reverse();
  const shorten = (items: string[]) => (items.length > 8 ? `${items.slice(0, 4).join(", ")} … ${items.slice(-2).join(", ")}` : items.join(", "));
  return { fronts: shorten(fronts), backs: shorten(backs) };
}

export function DuplexDialog({ open, total, onClose, onApply }: DuplexProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<DuplexChoice>({ pad: true, reverseBacks: true, twoFiles: true });
  const preview = sidesPreview(total, choice);

  return (
    <Dialog
      open={open}
      title={t("tools.pages.duplex.title")}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" variant="primary" disabled={total < 2} onClick={() => onApply(choice)}>{t("tools.pages.duplex.apply")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("tools.pages.duplex.intro")}</p>
        <SwitchField label={t("tools.pages.duplex.pad")} hint={t("tools.pages.duplex.padHint")} checked={choice.pad} disabled={total % 2 === 0} onChange={(pad) => setChoice((current) => ({ ...current, pad }))} />
        <SwitchField label={t("tools.pages.duplex.reverse")} hint={t("tools.pages.duplex.reverseHint")} checked={choice.reverseBacks} onChange={(reverseBacks) => setChoice((current) => ({ ...current, reverseBacks }))} />
        <SwitchField label={t("tools.pages.duplex.twoFiles")} hint={t("tools.pages.duplex.twoFilesHint")} checked={choice.twoFiles} onChange={(twoFiles) => setChoice((current) => ({ ...current, twoFiles }))} />
        <dl className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-sans text-muted-foreground">{t("tools.pages.duplex.fronts")}</dt>
            <dd className="min-w-0 truncate">{preview.fronts}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-sans text-muted-foreground">{t("tools.pages.duplex.backs")}</dt>
            <dd className="min-w-0 truncate">{preview.backs || "—"}</dd>
          </div>
        </dl>
      </div>
    </Dialog>
  );
}

const LABEL_STYLES: PageLabelStyle[] = ["D", "r", "R", "a", "A", ""];

type LabelProps = {
  open: boolean;
  position: number;
  current: TileLabel | null;
  hasLabels: boolean;
  onClose: () => void;
  onApply: (label: TileLabel) => void;
  onRemove: () => void;
  onClearAll: () => void;
};

export function PageLabelDialog({ open, position, current, hasLabels, onClose, onApply, onRemove, onClearAll }: LabelProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState<TileLabel>({ style: "D", prefix: "", firstNumber: 1 });

  useEffect(() => {
    if (open) setLabel(current ?? { style: "D", prefix: "", firstNumber: 1 });
  }, [open, current]);

  const sample = [0, 1, 2].map((offset) => formatLabel(label, offset));
  const presets: Array<[string, TileLabel]> = [
    ["cover", { style: "", prefix: t("tools.pages.labels.coverText"), firstNumber: 1 }],
    ["roman", { style: "r", prefix: "", firstNumber: 1 }],
    ["fromOne", { style: "D", prefix: "", firstNumber: 1 }],
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (label.style === "" && !label.prefix.trim()) return;
    onApply({ ...label, firstNumber: Math.max(1, Math.min(100000, Math.round(label.firstNumber) || 1)) });
  };

  return (
    <Dialog open={open} title={t("tools.pages.labels.title", { page: position + 1 })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("tools.pages.labels.intro")}</p>
        <div className="flex flex-wrap gap-2">
          {presets.map(([name, preset]) => (
            <Button key={name} size="sm" variant="ghost" onClick={() => setLabel(preset)}>
              {t(`tools.pages.labels.preset.${name}`)}
            </Button>
          ))}
        </div>
        <Field label={t("tools.pages.labels.style")}>
          <SelectInput value={label.style} onChange={(event) => setLabel((currentLabel) => ({ ...currentLabel, style: event.target.value as PageLabelStyle }))}>
            {LABEL_STYLES.map((style) => (
              <option key={style || "none"} value={style}>
                {t(`tools.pages.labels.styles.${style || "none"}`)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("tools.pages.labels.prefix")} hint={t("tools.pages.labels.prefixHint")}>
          <TextInput value={label.prefix} maxLength={64} onChange={(event) => setLabel((currentLabel) => ({ ...currentLabel, prefix: event.target.value }))} />
        </Field>
        {label.style ? (
          <Field label={t("tools.pages.labels.start")}>
            <TextInput type="number" min={1} max={100000} value={label.firstNumber} onChange={(event) => setLabel((currentLabel) => ({ ...currentLabel, firstNumber: Number(event.target.value) }))} className="w-28 font-mono" />
          </Field>
        ) : null}
        <p className="text-sm">
          <span className="text-muted-foreground">{t("tools.pages.labels.sample")} </span>
          <span className="font-mono">{label.style ? `${sample.join(", ")} …` : sample[0] || "—"}</span>
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {hasLabels ? (
            <Button variant="ghost" onClick={onClearAll}>{t("tools.pages.labels.clearAll")}</Button>
          ) : null}
          {current ? (
            <Button variant="ghost" onClick={onRemove}>{t("tools.pages.labels.remove")}</Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={label.style === "" && !label.prefix.trim()}>{t("tools.pages.labels.apply")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
