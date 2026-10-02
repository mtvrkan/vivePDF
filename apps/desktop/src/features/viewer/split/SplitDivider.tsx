import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, type SplitLayout } from "@/shared/store/splitViewStore";

const KEYBOARD_STEP = 0.05;

type SplitDividerProps = {
  layout: SplitLayout;
  ratio: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onRatioChange: (ratio: number) => void;
};

export function SplitDivider({ layout, ratio, containerRef, onRatioChange }: SplitDividerProps) {
  const { t } = useTranslation();
  const columns = layout === "columns";
  const draggingRef = useRef<number | null>(null);

  const ratioAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return columns ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = event.pointerId;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current === event.pointerId) draggingRef.current = null;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== event.pointerId) return;
    const next = ratioAt(event);
    if (next !== null) onRatioChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const smaller = columns ? "ArrowLeft" : "ArrowUp";
    const larger = columns ? "ArrowRight" : "ArrowDown";
    let next: number | null = null;
    if (event.key === smaller) next = ratio - KEYBOARD_STEP;
    else if (event.key === larger) next = ratio + KEYBOARD_STEP;
    else if (event.key === "Home") next = SPLIT_RATIO_MIN;
    else if (event.key === "End") next = SPLIT_RATIO_MAX;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onRatioChange(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("viewer.split.divider")}
      aria-orientation={columns ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(SPLIT_RATIO_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_RATIO_MAX * 100)}
      data-split-divider=""
      className={cn(
        "group flex touch-none items-center justify-center bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        columns ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <span className={cn("rounded-full bg-border transition-colors duration-(--transition-fast) group-hover:bg-primary", columns ? "h-8 w-0.5" : "h-0.5 w-8")} aria-hidden />
    </div>
  );
}
