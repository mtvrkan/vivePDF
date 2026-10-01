import { Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePresentationStore } from "@/shared/store/presentationStore";
import type { PageRect } from "./usePageRects";
import { useCodeBlocksForPage } from "./useCodeBlocks";

export function CodeBlockMarkers({ documentId, rect }: { documentId: string; rect: PageRect }) {
  const { t } = useTranslation();
  const entry = useCodeBlocksForPage(documentId, rect.pageIndex);
  const openCodeBlock = usePresentationStore((state) => state.openCodeBlock);
  if (!entry || entry.blocks.length === 0) return null;
  const scaleX = rect.width / entry.width;
  const scaleY = rect.height / entry.height;

  return (
    <>
      {entry.blocks.map((block) => {
        const [x0, y0, x1, y1] = block.bbox;
        const left = rect.left + x0 * scaleX;
        const top = rect.top + y0 * scaleY;
        const width = (x1 - x0) * scaleX;
        const height = (y1 - y0) * scaleY;
        return (
          <div key={block.id} className="pointer-events-none absolute" style={{ left, top, width, height }}>
            <div className="absolute inset-0 rounded-md border-2 border-dashed border-primary/70" />
            <button
              type="button"
              onClick={() => openCodeBlock(rect.pageIndex, block.id)}
              className="glass-chip pointer-events-auto absolute -top-3 left-2 flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[11px] text-primary"
              aria-label={t("presentation.openCodeBlock")}
            >
              <Code2 className="size-3" aria-hidden />
              {block.language ?? t("presentation.codeGeneric")}
            </button>
          </div>
        );
      })}
    </>
  );
}
