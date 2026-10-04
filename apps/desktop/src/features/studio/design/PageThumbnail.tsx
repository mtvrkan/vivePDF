import { memo, useDeferredValue, useRef, type RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import type { StudioPage } from "@/types/studio";
import type { DropSide } from "./dragSort";
import { PageView } from "./ElementView";
import { useInView } from "./useInView";

export const PageThumbnail = memo(function PageThumbnail({ page, language, scale, root, margin }: { page: StudioPage; language: string; scale: number; root: RefObject<Element | null> | null; margin?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref, root, margin);
  const shown = useDeferredValue(page);
  return (
    <span ref={ref} className="relative block overflow-hidden" style={{ width: `${page.width * scale}px`, height: `${page.height * scale}px` }} aria-hidden>
      {visible ? (
        <span className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <PageView page={shown} language={language} />
        </span>
      ) : (
        <span data-thumbnail-state="waiting" className="block size-full bg-muted" />
      )}
    </span>
  );
});

export function PageDropLine({ side }: { side: DropSide }) {
  return <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-primary", side === "before" ? "-start-1.5" : "-end-1.5")} />;
}
