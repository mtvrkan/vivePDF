import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crop, ImagePlus, Link2, PenTool, Ruler, Signature, SquareDashed, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { EDITOR_MODES, useViewerOverlayStore, type OverlayMode } from "@/shared/store/viewerOverlayStore";
import type { LucideIcon } from "lucide-react";
import { DRAWING_SPECS } from "./drawing/drawingKinds";
import { DRAWING_KINDS } from "./drawing/drawingSource";
import { isPendingChange } from "./pending";

const ENTRIES: Array<{ mode: OverlayMode; icon: LucideIcon; labelKey: string }> = [
  { mode: "text", icon: Type, labelKey: "viewer.overlay.text" },
  { mode: "image", icon: ImagePlus, labelKey: "viewer.overlay.image" },
  { mode: "signature", icon: Signature, labelKey: "viewer.overlay.signature" },
  { mode: "link", icon: Link2, labelKey: "viewer.overlay.link" },
  { mode: "redact", icon: SquareDashed, labelKey: "viewer.overlay.redact" },
  { mode: "crop", icon: Crop, labelKey: "viewer.overlay.crop" },
  { mode: "measure", icon: Ruler, labelKey: "viewer.overlay.measure" },
];

const MENU_GAP = 6;
const MENU_EDGE = 6;

export function EditorMenu() {
  const { t } = useTranslation();
  const mode = useViewerOverlayStore((state) => state.mode);
  const setMode = useViewerOverlayStore((state) => state.setMode);
  const objects = useViewerOverlayStore((state) => state.objects);
  const requestLeave = useViewerOverlayStore((state) => state.requestLeave);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onLayout = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !trigger || !menu) {
      setPosition(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const top = Math.max(MENU_EDGE, Math.min(rect.top, window.innerHeight - menu.offsetHeight - MENU_EDGE));
    const left = Math.max(MENU_EDGE, rect.left - MENU_GAP - menu.offsetWidth);
    setPosition({ top, left });
  }, [open, mode]);

  const active = ENTRIES.find((entry) => entry.mode === mode);
  const ActiveIcon = active?.icon ?? PenTool;
  const triggerTitle = active ? `${t("viewer.overlay.editMenu")}: ${t(active.labelKey)}` : t("viewer.overlay.editMenu");

  const applyMode = (target: OverlayMode | null) => {
    const otherEditorMode = mode === "text" ? "image" : mode === "image" ? "text" : null;
    const leavingEditor = mode !== null && EDITOR_MODES.includes(mode) && target !== otherEditorMode;
    if (leavingEditor) requestLeave(() => setMode(target), objects.filter(isPendingChange).length > 0);
    else setMode(target);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("viewer.overlay.editMenu")}
        title={triggerTitle}
        onClick={() => setOpen((shown) => !shown)}
        className={cn("nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80 hover:text-foreground", active && "glass-chip text-primary")}
      >
        <ActiveIcon className="size-4" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t("viewer.overlay.editMenu")}
              className="glass-menu fixed z-50 w-max min-w-56 max-w-sm rounded-xl p-1"
              style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? "visible" : "hidden" }}
            >
              {ENTRIES.map((entry) => {
                const Icon = entry.icon;
                const selected = entry.mode === mode;
                return (
                  <button
                    key={entry.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      applyMode(selected ? null : entry.mode);
                      setOpen(false);
                    }}
                    className={cn("flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-start text-sm", selected ? "glass-chip text-primary" : "hover:bg-secondary")}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(entry.labelKey)}
                  </button>
                );
              })}
              {DRAWING_KINDS.map((kind) => {
                const { icon: Icon, labels } = DRAWING_SPECS[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      if (mode !== "image") applyMode("image");
                      useViewerOverlayStore.getState().openDrawingEditor(kind, null);
                      setOpen(false);
                    }}
                    className="flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-start text-sm hover:bg-secondary"
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(labels.menu)}
                  </button>
                );
              })}
              {mode ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    applyMode(null);
                    setOpen(false);
                  }}
                  className="mt-1 flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-lg border-t px-2.5 text-start text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {t("viewer.overlay.exitEditing")}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
