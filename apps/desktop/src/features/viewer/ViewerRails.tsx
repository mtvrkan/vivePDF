import type { KeyboardEvent, ReactNode } from "react";
import { BookOpenText, Contrast, FileSignature, Info, Layers, ListTree, MessageSquareText, PanelLeft, Paperclip, PenLine, Sparkles, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { usePresentationStore } from "@/shared/store/presentationStore";
import type { ViewerPanels } from "@/shared/store/viewerPanelsStore";
import { EditorMenu } from "./overlay/EditorMenu";

const RAIL_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function focusSibling(event: KeyboardEvent<HTMLDivElement>) {
  if (!RAIL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const index = buttons.findIndex((button) => button === event.target);
  if (index === -1) return;
  event.preventDefault();
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

function Rail({ label, side, children }: { label: string; side: "start" | "end"; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={label}
      data-viewer-rail={side}
      onKeyDown={focusSibling}
      className={cn("glass-flat flex h-full w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto py-2", side === "start" ? "border-e" : "border-s")}
    >
      {children}
    </div>
  );
}

function RailDivider() {
  return <span className="my-1 h-px w-5 shrink-0 bg-border" aria-hidden />;
}

type RailProps = { panels: ViewerPanels; onTogglePanel: (panel: keyof ViewerPanels) => void };

export function NavigationRail({ panels, onTogglePanel, showSignatures = false, showLayers = false }: RailProps & { showSignatures?: boolean; showLayers?: boolean }) {
  const { t } = useTranslation();
  return (
    <Rail label={t("viewer.rails.navigation")} side="start">
      <IconButton icon={PanelLeft} label={t("viewer.thumbnails")} active={panels.thumbnails} onClick={() => onTogglePanel("thumbnails")} />
      <IconButton icon={ListTree} label={t("viewer.outline.title")} active={panels.outline} onClick={() => onTogglePanel("outline")} />
      <IconButton icon={Paperclip} label={t("viewer.attachments.title")} active={panels.attachments} onClick={() => onTogglePanel("attachments")} />
      {showSignatures ? <IconButton icon={FileSignature} label={t("viewer.signatures.title")} active={panels.signatures} onClick={() => onTogglePanel("signatures")} /> : null}
      {showLayers ? <IconButton icon={Layers} label={t("viewer.layers.title")} active={panels.layers} onClick={() => onTogglePanel("layers")} /> : null}
    </Rail>
  );
}

export function ToolsRail({ panels, onTogglePanel, pageColorsOn, onTogglePageColors }: RailProps & { pageColorsOn: boolean; onTogglePageColors: () => void }) {
  const { t } = useTranslation();
  return (
    <Rail label={t("viewer.rails.tools")} side="end">
      <IconButton icon={MessageSquareText} label={t("viewer.comments.title")} active={panels.comments} onClick={() => onTogglePanel("comments")} />
      <IconButton icon={PenLine} label={t("viewer.annotate")} active={panels.annotate} onClick={() => onTogglePanel("annotate")} />
      <EditorMenu />
      <IconButton
        icon={Sparkles}
        label={t("viewer.presentationTools")}
        active={panels.present}
        onClick={() => {
          if (panels.present) usePresentationStore.getState().setTool("pointer");
          onTogglePanel("present");
        }}
      />
      <RailDivider />
      <IconButton icon={BookOpenText} label={t("viewer.reading.title")} active={panels.reading} onClick={() => onTogglePanel("reading")} />
      <IconButton icon={Volume2} label={t("viewer.readAloud.title")} active={panels.readAloud} onClick={() => onTogglePanel("readAloud")} />
      <IconButton icon={Contrast} label={t("viewer.pageDisplay.pageColors")} active={pageColorsOn} onClick={onTogglePageColors} />
      <RailDivider />
      <IconButton icon={Info} label={t("viewer.inspector")} active={panels.inspector} onClick={() => onTogglePanel("inspector")} />
    </Rail>
  );
}
