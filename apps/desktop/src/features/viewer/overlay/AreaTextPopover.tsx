import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, Copy, Loader2, ScanText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { IconButton } from "@/components/shared/IconButton";
import { describeError } from "@/shared/lib/errorMessage";
import { reindentLines } from "@/shared/lib/codeReindent";
import { toRpcError } from "@/shared/rpc/client";
import { ocrArea } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { OcrAreaLine } from "@/types";
import { looksLikeCode, screenRectFor } from "./areaText";
import { computeToolbarPlacement } from "./toolbarPlacement";
import { visiblePageSize } from "./pageSize";
import { viewTurnsOf } from "./pageFrame";
import { preferredOcrLanguages } from "../ocrLanguages";

const PANEL_WIDTH = 340;
const FALLBACK_HEIGHT = 180;

type Loaded = { text: string; lines: OcrAreaLine[]; recognized: boolean };

export function AreaTextPopover({ documentId, onMakeSearchable }: { documentId: string; onMakeSearchable: (pageIndex: number) => void }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const request = useViewerOverlayStore((state) => state.areaTextRequest);
  const clearAreaText = useViewerOverlayStore((state) => state.clearAreaText);
  const { provides: selection } = useSelectionCapability();
  const panelRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);

  const token = request?.token ?? null;

  useEffect(() => {
    if (!request || !document) return;
    selection?.forDocument(documentId).clear();
    let cancelled = false;
    setLoaded(null);
    setFailed(null);
    setDraft("");
    void ocrArea({
      path: document.path,
      password: document.password ?? undefined,
      page: request.pageIndex,
      rect: [request.x0, request.y0, request.x1, request.y1],
      languages: preferredOcrLanguages(),
    })
      .then((result) => {
        if (cancelled) return;
        setLoaded(result);
        setDraft(result.text);
      })
      .catch((error) => {
        if (!cancelled) setFailed(describeError(t, toRpcError(error)));
      });
    return () => {
      cancelled = true;
    };
  }, [token, request, document, documentId, selection, t]);

  useLayoutEffect(() => {
    if (!request) {
      setPlacement(null);
      return;
    }
    const host = window.document.querySelector(`[data-page-index="${request.pageIndex}"]`);
    if (!host) return;
    const anchor = host.getBoundingClientRect();
    const turns = viewTurnsOf(host as HTMLElement);
    const acrossPx = turns % 2 === 1 ? anchor.height : anchor.width;
    const page = visiblePageSize(documentId, request.pageIndex, acrossPx, turns % 2 === 1 ? anchor.width : anchor.height);
    const scale = page.width > 0 ? acrossPx / page.width : 1;
    const area = screenRectFor({ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }, scale, request, turns);
    const size = panelRef.current?.getBoundingClientRect();
    setPlacement(
      computeToolbarPlacement(area, { width: size?.width ?? PANEL_WIDTH, height: size?.height ?? FALLBACK_HEIGHT }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [request, documentId, loaded, failed]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearAreaText();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-area-text]")) return;
      clearAreaText();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [request, clearAreaText]);

  if (!request || !document) return null;

  const copyPlain = async () => {
    await navigator.clipboard.writeText(draft);
    toast("success", t("viewer.selection.copied"));
    clearAreaText();
  };

  const copyAsCode = async () => {
    const lines = draft.split("\n");
    const rects = (loaded?.lines ?? []).map((line) => ({ x: line.x0, width: line.x1 - line.x0 }));
    await navigator.clipboard.writeText(reindentLines(lines, rects).join("\n"));
    toast("success", t("viewer.context.codeCopied"));
    clearAreaText();
  };

  const showCode = loaded !== null && looksLikeCode(loaded.lines.map((line) => ({ text: line.text, x0: line.x0, x1: line.x1 })));

  return createPortal(
    <div
      ref={panelRef}
      data-area-text
      className="glass-menu fixed z-[100] flex w-[21rem] max-w-[92vw] flex-col gap-1.5 rounded-xl p-2"
      style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? "visible" : "hidden" }}
      role="dialog"
      aria-label={t("viewer.areaText.title")}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {loaded === null ? t("viewer.areaText.reading") : loaded.recognized ? t("viewer.areaText.recognized") : t("viewer.areaText.fromTextLayer")}
        </span>
        <IconButton icon={Copy} label={t("viewer.selection.copy")} disabled={!draft.trim()} onClick={() => void copyPlain()} />
        {showCode ? <IconButton icon={Braces} label={t("viewer.selection.copyAsCode")} onClick={() => void copyAsCode()} /> : null}
        <IconButton icon={X} label={t("common.close")} onClick={clearAreaText} />
      </div>
      {failed ? (
        <p className="px-1 pb-1 text-xs text-destructive">{failed}</p>
      ) : loaded === null ? (
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label={t("viewer.areaText.title")}
            className="field max-h-64 min-h-20 w-full resize-y rounded-lg p-2 font-mono text-xs"
            placeholder={t("viewer.areaText.empty")}
          />
          {loaded.recognized ? (
            <button
              type="button"
              onClick={() => {
                clearAreaText();
                onMakeSearchable(request.pageIndex);
              }}
              className="glass-chip inline-flex h-7 items-center gap-1.5 self-start rounded-xl px-2.5 text-xs text-primary"
            >
              <ScanText className="size-3.5" aria-hidden />
              {t("viewer.searchable.thisPage")}
            </button>
          ) : null}
        </>
      )}
    </div>,
    window.document.body,
  );
}
