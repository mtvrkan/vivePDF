import { cn } from "@/shared/lib/cn";
import type { PageRect } from "./usePageRects";

export function CurrentPageMask({ rects, pageIndex, tone }: { rects: PageRect[]; pageIndex: number; tone: "muted" | "black" }) {
  const rect = rects.find((item) => item.pageIndex === pageIndex);
  if (!rect) return null;
  const fill = tone === "black" ? "bg-black" : "bg-muted";
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  return (
    <div aria-hidden data-testid="current-page-mask" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={cn("absolute inset-x-0 top-0", fill)} style={{ height: Math.max(0, rect.top) }} />
      <div className={cn("absolute inset-x-0 bottom-0", fill)} style={{ top: Math.max(0, bottom) }} />
      <div className={cn("absolute left-0", fill)} style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }} />
      <div className={cn("absolute right-0", fill)} style={{ top: rect.top, height: rect.height, left: Math.max(0, right) }} />
    </div>
  );
}
