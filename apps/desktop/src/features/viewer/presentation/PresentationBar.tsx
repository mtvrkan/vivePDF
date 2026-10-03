import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { IconButton } from "@/components/shared/IconButton";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { TemporaryDrawingCleanup } from "./DrawingCleanupButton";
import { PresentationStyleControls, PresentationStyleTrigger, PresentationToolButtons } from "./PresentationTools";
import { hasStyleOptions } from "./toolPresets";

export function PresentationBar({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const tool = usePresentationStore((state) => state.tool);
  const setTool = usePresentationStore((state) => state.setTool);
  const { state: scrollState } = useScroll(documentId);
  const [styleOpen, setStyleOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTypingTarget(event.target)) return;
      if (usePresentationStore.getState().tool === "pointer") return;
      event.preventDefault();
      event.stopPropagation();
      setTool("pointer");
      setStyleOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [setTool]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2">
      {styleOpen && hasStyleOptions(tool) ? (
        <div className="glass select-pop pointer-events-auto origin-bottom rounded-2xl p-3">
          <PresentationStyleControls />
        </div>
      ) : null}
      <div className="glass pointer-events-auto flex h-11 items-center gap-1 rounded-full px-2">
        <PresentationToolButtons
          onSelect={(next) => {
            if (!hasStyleOptions(next)) setStyleOpen(false);
          }}
        />
        <PresentationStyleTrigger open={styleOpen} onToggle={() => setStyleOpen((current) => !current)} />
        <TemporaryDrawingCleanup pageIndex={scrollState.currentPage - 1} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconButton icon={X} label={t("common.close")} onClick={onClose} />
      </div>
    </div>
  );
}
