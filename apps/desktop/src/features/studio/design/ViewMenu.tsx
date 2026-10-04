import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, Magnet, Ruler, Scissors, SeparatorHorizontal, SquareDashed, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { MAX_MARGIN_MM } from "../model/design";
import { clearGuides, guidesOf, marginsOf, withMargins } from "../model/guides";
import { NumberField } from "./controls";
import { currentPage, useStudioStore } from "./studioStore";
import { useViewPrefs, type StudioViewOption } from "./viewPrefs";

const GAP = 6;
const EDGE = 8;

const OPTIONS: { option: StudioViewOption; icon: LucideIcon; shortcut?: string }[] = [
  { option: "rulers", icon: Ruler, shortcut: "Shift+R" },
  { option: "guides", icon: SeparatorHorizontal, shortcut: "Shift+G" },
  { option: "margins", icon: SquareDashed, shortcut: "Shift+M" },
  { option: "bleed", icon: Scissors },
  { option: "snap", icon: Magnet },
];

const ROW = "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

export function ViewMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prefs = useViewPrefs();
  const margins = useStudioStore((state) => (state.design ? marginsOf(state.design) : 0));
  const guideCount = useStudioStore((state) => {
    const page = currentPage(state);
    return page ? guidesOf(page).length : 0;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - EDGE));
    setAnchor({ top: rect.bottom + GAP, left });
    panel.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("studio.view.menu")}
        title={t("studio.view.menu")}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="studio-view-menu"
        onClick={() => setOpen((value) => !value)}
        className={cn("nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80 hover:text-foreground", open && "glass-chip text-primary")}
      >
        <Eye className="size-4" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="group"
              aria-label={t("studio.view.menu")}
              className="glass-menu fixed z-50 w-72 rounded-xl p-1"
              style={{ top: anchor?.top ?? -9999, left: anchor?.left ?? -9999, visibility: anchor ? "visible" : "hidden" }}
            >
              {OPTIONS.map(({ option, icon: Icon, shortcut }) => (
                <button key={option} type="button" role="switch" aria-checked={prefs[option]} aria-keyshortcuts={shortcut} onClick={() => prefs.toggle(option)} className={ROW}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 text-left">{t(`studio.view.${option}`)}</span>
                  {shortcut ? <span className="text-xs text-muted-foreground">{shortcut}</span> : null}
                  <Check className={cn("size-3.5 text-primary", !prefs[option] && "invisible")} aria-hidden />
                </button>
              ))}
              <div role="separator" className="my-1 h-px bg-border" />
              <div className="px-2.5 py-1.5">
                <NumberField
                  label={t("studio.view.marginSize")}
                  suffix="mm"
                  value={margins}
                  min={0}
                  max={MAX_MARGIN_MM}
                  step={1}
                  onChange={(value) => useStudioStore.getState().apply((design) => withMargins(design, value), { merge: "margins" })}
                />
              </div>
              <button type="button" disabled={!guideCount} onClick={() => useStudioStore.getState().applyToPage(clearGuides)} className={ROW}>
                <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 text-left">{t("studio.view.clearGuides")}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
