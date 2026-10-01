import { useLayoutEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, FolderSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { basenameOf } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";
import { outputWindow, visibleSpan, WINDOW_FROM } from "./outputWindow";
import { resultOpenLabelKey } from "./resultOpenLabel";

export function OutputList({ outputs, onOpen, onReveal }: { outputs: string[]; onOpen: (output: string) => void; onReveal: (output: string) => void }) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const [frame, setFrame] = useState({ scrollTop: 0, viewport: 0, rowHeight: 0 });
  const windowed = outputs.length >= WINDOW_FROM;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !windowed) return;
    let frameId: number | null = null;
    const measure = () => {
      const row = list.querySelector<HTMLElement>("li[data-output]");
      const box = list.getBoundingClientRect();
      const next = { ...visibleSpan(box.top, box.bottom, list.scrollTop, window.innerHeight), rowHeight: row?.offsetHeight ?? 0 };
      setFrame((current) => (current.scrollTop === next.scrollTop && current.viewport === next.viewport && current.rowHeight === next.rowHeight ? current : next));
    };
    const onScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [windowed]);

  const view = outputWindow(outputs.length, frame.scrollTop, frame.viewport, frame.rowHeight);

  return (
    <ul ref={listRef} className="min-h-0 overflow-auto">
      {view.paddingTop > 0 ? <li role="none" aria-hidden style={{ height: view.paddingTop }} /> : null}
      {outputs.slice(view.start, view.end).map((output, offset) => (
        <li key={output} data-output aria-posinset={windowed ? view.start + offset + 1 : undefined} aria-setsize={windowed ? outputs.length : undefined} className="flex h-row items-center gap-2 border-b px-4 text-sm">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={output}>
            {basenameOf(output)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={isPdfPath(output) ? <BookOpen className="size-4" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
            onClick={() => onOpen(output)}
            aria-label={t(resultOpenLabelKey(output))}
          />
          <Button size="sm" variant="ghost" icon={<FolderSearch className="size-4" aria-hidden />} onClick={() => onReveal(output)} aria-label={t("tools.reveal")} />
        </li>
      ))}
      {view.paddingBottom > 0 ? <li role="none" aria-hidden style={{ height: view.paddingBottom }} /> : null}
    </ul>
  );
}
