import type { PageRect } from "./usePageRects";

export function CurrentPageMask({ rects, pageIndex }: { rects: PageRect[]; pageIndex: number }) {
  const rect = rects.find((item) => item.pageIndex === pageIndex);
  if (!rect) return null;
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  return (
    <div aria-hidden data-testid="current-page-mask" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-0 bg-black" style={{ height: Math.max(0, rect.top) }} />
      <div className="absolute inset-x-0 bottom-0 bg-black" style={{ top: Math.max(0, bottom) }} />
      <div className="absolute left-0 bg-black" style={{ top: rect.top, height: rect.height, width: Math.max(0, rect.left) }} />
      <div className="absolute right-0 bg-black" style={{ top: rect.top, height: rect.height, left: Math.max(0, right) }} />
    </div>
  );
}
