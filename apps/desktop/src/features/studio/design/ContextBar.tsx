import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Crop, File, Italic, Lock, LockOpen, Move, PanelRight, SlidersHorizontal, Underline } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import type { StudioElement, StudioTextAlign, StudioTextElement } from "@/types/studio";
import { toggleLock } from "./commands";
import { NumberInput, StudioColorSwatch } from "./controls";
import { beginCrop, croppable } from "./cropMode";
import { kindIcon } from "./labels";
import { useSidePanelsStore, type DetailsSection } from "./sidePanels";
import { currentPage, selectedElements, useStudioStore } from "./studioStore";
import { useTextFormatting } from "./textFormatting";
import { useHeldWhileInteracting } from "./useHeldWhileInteracting";

const TEXT_ALIGNS: StudioTextAlign[] = ["left", "center", "right", "justify"];
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
const MIN_SIZE = 1;
const MAX_SIZE = 1000;

const keepSelection = (event: MouseEvent) => event.preventDefault();

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />;
}

function BarButton({ icon: Icon, label, onClick, active, disabled, testId }: { icon: typeof Move; label: string; onClick: () => void; active?: boolean; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active ? "bg-accent text-accent-foreground" : "text-foreground/85 hover:bg-(--hover-bg) hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

const TextTools = memo(function TextTools({ elements }: { elements: StudioTextElement[] }) {
  const { t } = useTranslation();
  const { first, style, weight, shownSize, change, applyStyle, toggle, setSize } = useTextFormatting(elements);
  return (
    <>
      <div className="w-48 shrink-0">
        <FontPicker compact value={style.fontId} onChange={(fontId) => applyStyle({ fontId })} />
      </div>
      <NumberInput value={shownSize} min={MIN_SIZE} max={MAX_SIZE} suffix="pt" ariaLabel={t("studio.props.fontSize")} onChange={setSize} className="w-20 shrink-0" />
      <Divider />
      <div className="flex shrink-0 items-center gap-0.5" onMouseDown={keepSelection}>
        <IconButton icon={Bold} label={t("studio.props.bold")} shortcut="Ctrl+B" active={weight >= 600} onClick={() => toggle("bold")} />
        <IconButton icon={Italic} label={t("studio.props.italic")} shortcut="Ctrl+I" active={style.italic} onClick={() => toggle("italic")} />
        <IconButton icon={Underline} label={t("studio.props.underline")} shortcut="Ctrl+U" active={style.underline} onClick={() => toggle("underline")} />
      </div>
      <StudioColorSwatch value={style.color} label={t("studio.props.color")} onChange={(color) => applyStyle({ color })} />
      <Divider />
      <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={t("studio.props.align")} onMouseDown={keepSelection}>
        {TEXT_ALIGNS.map((value) => (
          <IconButton key={value} icon={ALIGN_ICONS[value]} active={first.align === value} label={t(`studio.textAlign.${value}`)} onClick={() => change(() => ({ align: value }))} />
        ))}
      </div>
    </>
  );
});

function selectionLabel(elements: StudioElement[], t: (key: string, options?: Record<string, unknown>) => string): string {
  if (elements.length === 0) return t("studio.panel.page");
  if (elements.length > 1) return t("studio.context.many", { count: elements.length });
  return t(`studio.kinds.${elements[0].kind}`);
}

function Label({ elements }: { elements: StudioElement[] }) {
  const { t } = useTranslation();
  const Icon = elements.length === 1 ? kindIcon(elements[0]) : File;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 pe-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid="studio-context-kind">
      <Icon className="size-4" aria-hidden />
      {selectionLabel(elements, t)}
    </span>
  );
}

export function ContextBar() {
  const { t } = useTranslation();
  const hasPage = useStudioStore((state) => Boolean(currentPage(state)));
  const elements = useHeldWhileInteracting(useStudioStore(useShallow((state) => selectedElements(state))));
  const detailsOpen = useSidePanelsStore((state) => state.detailsOpen);
  const openDetails = useSidePanelsStore((state) => state.openDetails);
  const closeDetails = useSidePanelsStore((state) => state.closeDetails);
  const texts = useMemo(() => elements.filter((element): element is StudioTextElement => element.kind === "text"), [elements]);
  if (!hasPage) return null;
  const onlyTexts = texts.length > 0 && texts.length === elements.length;
  const single = elements.length === 1 ? elements[0] : null;
  const locked = elements.length > 0 && elements.every((element) => element.locked);
  const show = (section?: DetailsSection) => openDetails(section);

  let tools: ReactNode = null;
  if (elements.length === 0) {
    tools = <BarButton icon={SlidersHorizontal} label={t("studio.context.pageSettings")} onClick={() => show()} />;
  } else {
    tools = (
      <>
        {onlyTexts ? <TextTools elements={texts} /> : null}
        {single?.kind === "image" ? (
          <>
            <BarButton icon={Crop} label={t("studio.crop.button")} disabled={!croppable(single)} onClick={() => void beginCrop(single)} />
            <BarButton icon={SlidersHorizontal} label={t("studio.filters.title")} onClick={() => show("image")} />
          </>
        ) : null}
        {onlyTexts || single?.kind === "image" ? <Divider /> : null}
        <BarButton icon={Move} label={t("studio.props.arrange")} onClick={() => show("arrange")} testId="studio-context-arrange" />
        <IconButton icon={locked ? Lock : LockOpen} active={locked} label={locked ? t("studio.props.unlock") : t("studio.props.lock")} onClick={toggleLock} />
      </>
    );
  }

  return (
    <div role="toolbar" aria-label={t("studio.context.label")} className="glass flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-3" data-testid="studio-context-bar">
      <Label elements={elements} />
      {tools}
      <span className="ms-auto" />
      <BarButton icon={PanelRight} label={t("studio.context.details")} active={detailsOpen} onClick={() => (detailsOpen ? closeDetails() : show())} testId="studio-details-toggle" />
    </div>
  );
}
