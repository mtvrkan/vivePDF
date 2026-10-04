import { ArrowLeft, Download, FilePlus2, Group, Keyboard, Maximize, Printer, Redo2, Save, Undo2, Ungroup, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { canGroup, canUngroup, group, ungroup } from "./commands";
import { basenameOf } from "@/shared/lib/paths";
import { useStudioStore } from "./studioStore";
import { useDesignSave } from "./useDesignSave";
import { ViewMenu } from "./ViewMenu";

const ZOOM_STEP = 1.25;

export function StudioToolbar({ onExport, onPrint, onLeave, onHelp }: { onExport: () => void; onPrint: () => void; onLeave: () => void; onHelp: () => void }) {
  const { t } = useTranslation();
  const name = useStudioStore((state) => state.design?.name ?? "");
  const canUndo = useStudioStore((state) => state.past.length > 0);
  const canRedo = useStudioStore((state) => state.future.length > 0);
  const zoom = useStudioStore((state) => state.zoom);
  const fit = useStudioStore((state) => state.fit);
  const filePath = useStudioStore((state) => state.filePath);
  const dirty = useStudioStore((state) => state.dirty);
  const { saving, save } = useDesignSave();
  useStudioStore((state) => state.selection);
  const store = useStudioStore.getState();

  return (
    <div className="glass flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3" role="toolbar" aria-label={t("studio.toolbar.label")}>
      <IconButton icon={ArrowLeft} label={t("studio.toolbar.leave")} onClick={onLeave} />
      <input
        value={name}
        maxLength={200}
        placeholder={t("studio.untitled")}
        aria-label={t("studio.toolbar.name")}
        onChange={(event) => store.apply((design) => ({ ...design, name: event.target.value }), { merge: "name" })}
        className="field h-8 w-56 min-w-0 rounded-lg px-2 text-sm font-medium"
      />
      <span className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline" title={filePath ?? undefined} data-testid="studio-save-state">
        {filePath ? (dirty ? t("studio.project.edited", { name: basenameOf(filePath) }) : basenameOf(filePath)) : t("studio.project.notSaved")}
      </span>
      <IconButton icon={Save} label={t("studio.project.save")} shortcut="Ctrl+S" disabled={saving} onClick={() => void save(false)} />
      <IconButton icon={FilePlus2} label={t("studio.project.saveAs")} shortcut="Ctrl+Shift+S" disabled={saving} onClick={() => void save(true)} />
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      <IconButton icon={Undo2} label={t("studio.toolbar.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={store.undo} />
      <IconButton icon={Redo2} label={t("studio.toolbar.redo")} shortcut="Ctrl+Y" disabled={!canRedo} onClick={store.redo} />
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      <IconButton icon={Group} label={t("studio.menu.group")} shortcut="Ctrl+G" disabled={!canGroup()} onClick={group} />
      <IconButton icon={Ungroup} label={t("studio.menu.ungroup")} shortcut="Ctrl+Shift+G" disabled={!canUngroup()} onClick={ungroup} />
      <div className="ml-auto flex items-center gap-1">
        <ViewMenu />
        <IconButton icon={ZoomOut} label={t("studio.toolbar.zoomOut")} shortcut="Ctrl+-" onClick={() => store.setZoom(zoom / ZOOM_STEP)} />
        <button type="button" onClick={store.setFit} aria-label={t("studio.toolbar.fit")} title={t("studio.toolbar.fit")} className="h-8 min-w-14 rounded-lg px-2 text-sm tabular-nums text-foreground/80 hover:text-foreground" aria-pressed={fit}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton icon={ZoomIn} label={t("studio.toolbar.zoomIn")} shortcut="Ctrl++" onClick={() => store.setZoom(zoom * ZOOM_STEP)} />
        <IconButton icon={Maximize} label={t("studio.toolbar.fit")} shortcut="Ctrl+0" active={fit} onClick={store.setFit} />
        <IconButton icon={Keyboard} label={t("studio.shortcuts.title")} shortcut="?" onClick={onHelp} />
        <IconButton icon={Printer} label={t("studio.toolbar.print")} shortcut="Ctrl+P" onClick={onPrint} />
        <Button variant="primary" icon={<Download className="size-4" aria-hidden />} onClick={onExport} className="ml-2">
          {t("studio.toolbar.export")}
        </Button>
      </div>
    </div>
  );
}
