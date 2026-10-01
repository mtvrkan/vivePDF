import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { observeVisibility } from "@/features/pages/sharedVisibility";
import { cn } from "@/shared/lib/cn";
import { createThumbnailQueue } from "@/shared/lib/thumbnailQueue";
import { renderThumbnail, thumbnailDataUrl } from "@/shared/rpc/thumbnail";

const THUMB_WIDTH = 150;
const queue = createThumbnailQueue(3, 600);

export function LazyThumbnail({ path, password, page }: { path: string; password?: string; page: number }) {
  const key = `${path}|${page}`;
  const [url, setUrl] = useState<string | null>(() => queue.recall(key));
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeVisibility(element, setVisible);
  }, []);

  useEffect(() => {
    if (!visible || url) return;
    return queue.load(
      key,
      (signal) => renderThumbnail({ path, password, page: page - 1, width: THUMB_WIDTH }, { signal }).then(thumbnailDataUrl),
      (value) => {
        if (value) setUrl(value);
      },
    );
  }, [visible, url, key, path, password, page]);

  return (
    <div ref={ref} className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-muted">
      {url ? <img src={url} alt="" draggable={false} className="max-h-full max-w-full object-contain" /> : <div className="size-full animate-pulse bg-muted" />}
    </div>
  );
}

type TileProps = {
  path: string;
  password?: string;
  page: number;
  active: boolean;
  label: string;
  badge?: ReactNode;
  disabled?: boolean;
  dimInactive: boolean;
  onPress: (page: number, event: MouseEvent<HTMLButtonElement>) => void;
};

const PageTile = memo(function PageTile({ path, password, page, active, label, badge, disabled, dimInactive, onPress }: TileProps) {
  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => onPress(page, event)}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1.5 outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
          active ? "border-primary bg-primary/10" : cn("border-transparent", dimInactive && "opacity-60 hover:opacity-100"),
        )}
      >
        <LazyThumbnail path={path} password={password} page={page} />
        <span className={cn("font-mono text-xs tabular-nums", active ? "font-semibold text-foreground" : "text-muted-foreground")}>{page}</span>
      </button>
      {badge}
    </li>
  );
});

type PageGridProps = {
  path: string;
  password?: string;
  pageCount: number;
  isActive: (page: number) => boolean;
  labelOf: (page: number) => string;
  badgeOf?: (page: number) => ReactNode;
  onPress: (page: number, event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  dimInactive?: boolean;
  className?: string;
};

export function PageGrid({ path, password, pageCount, isActive, labelOf, badgeOf, onPress, disabled, dimInactive = true, className }: PageGridProps) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return (
    <ol className={cn("grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2", className)}>
      {pages.map((page) => (
        <PageTile key={page} path={path} password={password} page={page} active={isActive(page)} label={labelOf(page)} badge={badgeOf?.(page)} disabled={disabled} dimInactive={dimInactive} onPress={onPress} />
      ))}
    </ol>
  );
}
