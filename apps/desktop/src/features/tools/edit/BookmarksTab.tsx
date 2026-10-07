import { ArrowDown, ArrowDownWideNarrow, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, ListOrdered, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { withinRange } from "@/shared/lib/numberRange";
import type { BookmarkItem } from "@/types";
import { type BookmarkIssue, hasChildren, isPageTarget, pageOutOfRange, titleMissing } from "@/shared/lib/bookmarkTree";

const BOOKMARK_EVERY = { min: 1, max: 500 };
const ISSUE_MESSAGES: Record<BookmarkIssue, string> = {
  levels: "tools.edit.bookmarks.invalidLevels",
  title: "tools.edit.bookmarks.invalidTitle",
  page: "tools.edit.bookmarks.invalidPage",
};
const TARGET_LABELS = {
  web: "tools.edit.bookmarks.targetWeb",
  file: "tools.edit.bookmarks.targetFile",
  launch: "tools.edit.bookmarks.targetLaunch",
  other: "tools.edit.bookmarks.targetOther",
} as const;

function targetLabelKey(item: BookmarkItem) {
  const target = item.target ?? "other";
  return target === "page" ? TARGET_LABELS.other : TARGET_LABELS[target];
}

type BookmarksTabProps = {
  items: BookmarkItem[];
  issue: BookmarkIssue | null;
  pageCount: number;
  loading: boolean;
  generating: boolean;
  levels: number;
  onLevelsChange: (levels: number) => void;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: number) => void;
  onIndent: (index: number) => void;
  onOutdent: (index: number) => void;
  onChange: (index: number, patch: Partial<BookmarkItem>) => void;
  onGenerate: () => void;
  every: number;
  onEveryChange: (every: number) => void;
  onGenerateEvery: () => void;
  onImport: () => void;
  onExport: () => void;
  busy: boolean;
  onSort: () => void;
  onCollapseAll: (collapsed: boolean) => void;
  onToggle: (index: number) => void;
  openPanel: boolean;
  onOpenPanelChange: (value: boolean) => void;
};

export function BookmarksTab({
  items,
  issue,
  pageCount,
  loading,
  generating,
  levels,
  onLevelsChange,
  disabled,
  onAdd,
  onRemove,
  onMove,
  onIndent,
  onOutdent,
  onChange,
  onGenerate,
  every,
  onEveryChange,
  onGenerateEvery,
  onImport,
  onExport,
  busy,
  onSort,
  onCollapseAll,
  onToggle,
  openPanel,
  onOpenPanelChange,
}: BookmarksTabProps) {
  const { t } = useTranslation();
  const everyValid = withinRange(every, BOOKMARK_EVERY);

  return (
    <Section title={t("tools.edit.bookmarks.title")}>
      <p className="text-xs text-muted-foreground">{t("tools.edit.bookmarks.hint")}</p>
      <div className="flex items-center gap-2">
        <Button icon={<Wand2 className="size-4" aria-hidden />} onClick={onGenerate} loading={generating} disabled={disabled}>
          {t("tools.edit.bookmarks.generate")}
        </Button>
        <SelectInput
          value={levels}
          onChange={(event) => onLevelsChange(Number(event.target.value))}
          disabled={disabled}
          aria-label={t("tools.edit.bookmarks.levels")}
          className="w-44"
        >
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>
              {t("tools.edit.bookmarks.levelCount", { count: value })}
            </option>
          ))}
        </SelectInput>
        <Button icon={<Plus className="size-4" aria-hidden />} onClick={onAdd} disabled={disabled}>
          {t("tools.edit.bookmarks.add")}
        </Button>
        {loading ? <span className="font-mono text-xs text-muted-foreground">{t("common.loading")}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<ListOrdered className="size-4" aria-hidden />} onClick={onGenerateEvery} disabled={disabled || busy || !everyValid}>
          {t("tools.edit.bookmarks.everyPage")}
        </Button>
        <TextInput
          type="number"
          min={BOOKMARK_EVERY.min}
          max={BOOKMARK_EVERY.max}
          value={Number.isNaN(every) ? "" : every}
          onChange={(event) => onEveryChange(event.target.valueAsNumber)}
          disabled={disabled}
          aria-label={t("tools.edit.bookmarks.everyCount")}
          aria-invalid={!everyValid}
          title={everyValid ? undefined : t("tools.outOfRange", BOOKMARK_EVERY)}
          className="w-24 font-mono"
        />
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button icon={<Upload className="size-4" aria-hidden />} onClick={onImport} disabled={disabled || busy}>
          {t("tools.edit.bookmarks.import")}
        </Button>
        <Button icon={<Download className="size-4" aria-hidden />} onClick={onExport} disabled={disabled || busy}>
          {t("tools.edit.bookmarks.export")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<ArrowDownWideNarrow className="size-4" aria-hidden />} onClick={onSort} disabled={disabled || items.length < 2}>
          {t("tools.edit.bookmarks.sort")}
        </Button>
        <Button icon={<ChevronsUpDown className="size-4" aria-hidden />} onClick={() => onCollapseAll(false)} disabled={disabled || items.length === 0}>
          {t("tools.edit.bookmarks.expandAll")}
        </Button>
        <Button icon={<ChevronsDownUp className="size-4" aria-hidden />} onClick={() => onCollapseAll(true)} disabled={disabled || items.length === 0}>
          {t("tools.edit.bookmarks.collapseAll")}
        </Button>
      </div>
      <SwitchField label={t("tools.edit.bookmarks.openPanel")} hint={t("tools.edit.bookmarks.openPanelHint")} checked={openPanel} onChange={onOpenPanelChange} />
      {issue ? (
        <p className="text-xs text-destructive" role="alert">
          {t(ISSUE_MESSAGES[issue], { count: pageCount })}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("tools.edit.bookmarks.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-2 py-1.5" style={{ marginLeft: (item.level - 1) * 20 }}>
              {hasChildren(items, index) ? (
                <IconButton
                  icon={item.collapsed ? ChevronRight : ChevronDown}
                  label={t(item.collapsed ? "tools.edit.bookmarks.expand" : "tools.edit.bookmarks.collapse")}
                  aria-expanded={!item.collapsed}
                  onClick={() => onToggle(index)}
                  disabled={disabled}
                />
              ) : (
                <span className="size-6 shrink-0" aria-hidden />
              )}
              <IconButton icon={ChevronLeft} label={t("tools.edit.bookmarks.outdent")} onClick={() => onOutdent(index)} disabled={disabled || item.level <= 1} />
              <IconButton icon={ChevronRight} label={t("tools.edit.bookmarks.indent")} onClick={() => onIndent(index)} disabled={disabled} />
              <TextInput
                value={item.title}
                onChange={(event) => onChange(index, { title: event.target.value })}
                placeholder={t("tools.edit.bookmarks.titlePlaceholder")}
                aria-label={t("tools.edit.bookmarks.titlePlaceholder")}
                aria-invalid={titleMissing(item)}
                className={cn("h-8 flex-1 text-sm", item.bold && "font-semibold", item.italic && "italic")}
                disabled={disabled}
              />
              {isPageTarget(item) ? (
                <TextInput
                  type="number"
                  min={0}
                  max={pageCount}
                  value={Number.isNaN(item.page) ? "" : item.page}
                  onChange={(event) => onChange(index, { page: event.target.valueAsNumber })}
                  className="h-8 w-20 font-mono text-sm"
                  aria-label={t("tools.edit.bookmarks.page")}
                  aria-invalid={pageOutOfRange(item, pageCount)}
                  disabled={disabled}
                />
              ) : (
                <span
                  className="w-40 truncate font-mono text-xs text-muted-foreground"
                  title={item.uri ?? item.file ?? t(targetLabelKey(item))}
                >
                  {item.uri ?? item.file ?? t(targetLabelKey(item))}
                  <span className="sr-only">{` · ${t(targetLabelKey(item))}`}</span>
                </span>
              )}
              <IconButton icon={ArrowUp} label={t("tools.edit.bookmarks.moveUp")} onClick={() => onMove(index, -1)} disabled={disabled || index === 0} />
              <IconButton icon={ArrowDown} label={t("tools.edit.bookmarks.moveDown")} onClick={() => onMove(index, 1)} disabled={disabled || index === items.length - 1} />
              <IconButton icon={Trash2} label={t("common.delete")} onClick={() => onRemove(index)} disabled={disabled} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
