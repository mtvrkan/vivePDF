import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Braces, Copy, Languages, Link2, Quote, SquareDashed, Volume2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useRedaction } from "@embedpdf/plugin-redaction/react";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { PdfActionType, PdfAnnotationSubtype } from "@embedpdf/models";
import { IconButton } from "@/components/shared/IconButton";
import { reindentLines } from "@/shared/lib/codeReindent";
import { cleanCopiedText, reflowParagraphs } from "@/shared/lib/copyText";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { describeError } from "@/shared/lib/errorMessage";
import { isTypingTarget } from "@/shared/lib/typingTarget";
import { toRpcError } from "@/shared/rpc/client";
import { getCodeBlocks } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSpeechStore } from "@/shared/store/speechStore";
import { useUiStore } from "@/shared/store/uiStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useTranslationStore } from "@/shared/store/translationStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { copySelection } from "./copySelection";
import { normalizeLinkUri } from "./linkUri";
import type { CodeBlock } from "@/types";

type PdfRect = { origin: { x: number; y: number }; size: { width: number; height: number } };
type Anchor = { x: number; y: number };

const SECONDARY_BUTTON = 2;

export function SelectionActions({ documentId, containerRef }: { documentId: string; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const overlayMode = useViewerOverlayStore((state) => state.mode);
  const toolbarEnabled = usePreferencesStore((state) => state.selectionToolbar);
  const speakText = useSpeechStore((state) => state.speak);
  const { provides: selection } = useSelectionCapability();
  const { provides: redaction } = useRedaction(documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [text, setText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const pointerRef = useRef<Anchor | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const copyAsCodeRef = useRef<(() => Promise<void>) | null>(null);
  const [bubbleStyle, setBubbleStyle] = useState<{ left: number; top: number } | null>(null);
  const [codeBlock, setCodeBlock] = useState<CodeBlock | null>(null);
  const labels = usePageLabels(documentId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onPointerUp = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    container.addEventListener("pointerup", onPointerUp);
    return () => container.removeEventListener("pointerup", onPointerUp);
  }, [containerRef]);

  useEffect(() => {
    if (!selection) return;
    const scope = selection.forDocument(documentId);
    const unsubscribe = scope.onEndSelection(() => {
      void scope
        .getSelectedText()
        .toPromise()
        .then((lines) => {
          const joined = lines.join("\n").trim();
          if (!joined || !pointerRef.current) {
            setAnchor(null);
            return;
          }
          setText(joined);
          setLinkOpen(false);
          setAnchor(pointerRef.current);
        })
        .catch(() => setAnchor(null));
    });
    return () => {
      unsubscribe();
    };
  }, [selection, documentId]);

  useEffect(() => {
    if (!selection) return;
    const scope = selection.forDocument(documentId);
    const offChange = scope.onSelectionChange((range) => {
      if (!range) setAnchor(null);
    });
    const offEmpty = scope.onEmptySpaceClick(() => {
      scope.clear();
      setAnchor(null);
      setLinkOpen(false);
    });
    return () => {
      offChange();
      offEmpty();
    };
  }, [selection, documentId]);

  useEffect(() => {
    if (!anchor) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-selection-actions]")) return;
      if (event.button === SECONDARY_BUTTON && target?.closest("[data-pan-scroller]")) {
        event.stopPropagation();
        return;
      }
      setAnchor(null);
      setLinkOpen(false);
      if (target?.closest("[data-pan-scroller]")) selection?.forDocument(documentId).clear();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchor, selection, documentId]);

  const dismiss = () => {
    setAnchor(null);
    setLinkOpen(false);
    setLinkUrl("");
    setCodeBlock(null);
  };

  useEffect(() => {
    if (!anchor || !text || !document || !selection) {
      setCodeBlock(null);
      return;
    }
    const scope = selection.forDocument(documentId);
    const rects = (scope.getHighlightRects() ?? {}) as Record<string, PdfRect[]>;
    const [pageIndex, items] = Object.entries(rects).find(([, entries]) => entries.length > 0) ?? [];
    if (pageIndex === undefined || !items || items.length === 0) {
      setCodeBlock(null);
      return;
    }
    const box = items.reduce((acc, item) => ({
      x: Math.min(acc.x, item.origin.x),
      y: Math.min(acc.y, item.origin.y),
      right: Math.max(acc.x + acc.width, item.origin.x + item.size.width),
      bottom: Math.max(acc.y + acc.height, item.origin.y + item.size.height),
      width: 0,
      height: 0,
    }), { x: items[0].origin.x, y: items[0].origin.y, width: 0, height: 0, right: 0, bottom: 0 });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getCodeBlocks({ path: document.path, password: document.password ?? undefined, page: Number(pageIndex), visible: true })
        .then((result) => {
          if (cancelled) return;
          const match = result.blocks.find((block) => {
            const [bx, by, bw, bh] = block.bbox;
            return box.x < bx + bw && box.right > bx && box.y < by + bh && box.bottom > by;
          });
          setCodeBlock(match ?? null);
        })
        .catch(() => {
          if (!cancelled) setCodeBlock(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [anchor, text, document, selection, documentId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!anchor || !text || isTypingTarget(event.target)) return;
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyAsCodeRef.current?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anchor, text]);

  useLayoutEffect(() => {
    if (!anchor || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const bubbleRect = bubbleRef.current?.getBoundingClientRect();
    const width = bubbleRect?.width ?? 180;
    const margin = 8;
    const viewportLeft = containerRect.left + anchor.x - width / 2;
    const clampedLeft = Math.min(Math.max(margin, viewportLeft), window.innerWidth - width - margin);
    const viewportTop = containerRect.top + anchor.y + 12;
    const clampedTop = Math.min(Math.max(margin, viewportTop), window.innerHeight - margin);
    setBubbleStyle({ left: clampedLeft, top: clampedTop });
  }, [anchor, containerRef, linkOpen]);

  if (!anchor || !document || overlayMode || !toolbarEnabled) return null;
  const containerRect = containerRef.current?.getBoundingClientRect();
  const fallbackStyle = containerRect ? { left: containerRect.left + anchor.x - 90, top: containerRect.top + anchor.y + 12 } : { left: anchor.x, top: anchor.y };
  const style = bubbleStyle ?? fallbackStyle;
  const scope = selection?.forDocument(documentId);

  const rectsByPage = (): Array<{ page: number; x0: number; y0: number; x1: number; y1: number }> => {
    const rects = (scope?.getHighlightRects() ?? {}) as Record<string, PdfRect[]>;
    return Object.entries(rects).flatMap(([pageIndex, items]) =>
      items.map((item) => ({ page: Number(pageIndex) + 1, x0: item.origin.x, y0: item.origin.y, x1: item.origin.x + item.size.width, y1: item.origin.y + item.size.height })),
    );
  };

  const guarded = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    void copySelection(scope).then((done) => {
      if (done) toast("success", t("viewer.selection.copied"));
    });
    dismiss();
  };

  const copyAsCode = async () => {
    try {
      const rects = (scope?.getHighlightRects() ?? {}) as Record<string, PdfRect[]>;
      const [, items] = Object.entries(rects).find(([, entries]) => entries.length > 0) ?? [];
      const lines = text.split("\n");
      const code = codeBlock ? codeBlock.text : reindentLines(lines, (items ?? []).map((item) => ({ x: item.origin.x, width: item.size.width }))).join("\n");
      await navigator.clipboard.writeText(code);
      toast("success", t("viewer.context.codeCopied"));
      dismiss();
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };
  copyAsCodeRef.current = copyAsCode;

  const prose = () => reflowParagraphs(cleanCopiedText([text]));

  const copyAsQuotation = async () => {
    try {
      const page = pageLabelOf(labels, rectsByPage()[0]?.page ?? 1);
      await navigator.clipboard.writeText(t("viewer.context.quotation", { text: prose(), page }));
      toast("success", t("viewer.selection.copied"));
      dismiss();
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const speak = () => {
    if (!speakText(prose(), { lang: useUiStore.getState().locale })) toast("error", t("viewer.selection.readAloudUnavailable"));
    dismiss();
  };

  const translate = () => {
    useTranslationStore.getState().request(prose());
    useViewerPanelsStore.getState().setPanels((panels) => ({ ...panels, translate: true }));
    dismiss();
  };

  const redact = () =>
    guarded(async () => {
      if (!redaction) {
        toast("error", t("viewer.selection.redactUnavailable"));
        return;
      }
      await redaction.queueCurrentSelectionAsPending().toPromise();
      toast("success", t("viewer.selection.redactQueued"));
      dismiss();
    });

  const link = () =>
    guarded(async () => {
      const uri = normalizeLinkUri(linkUrl);
      if (!uri) {
        toast("error", t("viewer.link.invalidUrl"));
        return;
      }
      const areas = rectsByPage();
      if (areas.length === 0 || !annotation) return;
      const first = areas[0];
      const box = areas.filter((item) => item.page === first.page).reduce((acc, item) => ({ page: first.page, x0: Math.min(acc.x0, item.x0), y0: Math.min(acc.y0, item.y0), x1: Math.max(acc.x1, item.x1), y1: Math.max(acc.y1, item.y1) }), first);
      const pageIndex = first.page - 1;
      annotation.createAnnotation(pageIndex, {
        type: PdfAnnotationSubtype.LINK,
        id: crypto.randomUUID(),
        pageIndex,
        rect: { origin: { x: box.x0, y: box.y0 }, size: { width: box.x1 - box.x0, height: box.y1 - box.y0 } },
        target: { type: "action", action: { type: PdfActionType.URI, uri } },
      });
      toast("success", t("viewer.link.queued"));
      dismiss();
    });

  return createPortal(
    <div
      ref={bubbleRef}
      data-selection-actions
      className="glass-menu fixed z-[100] flex max-w-[min(92vw,24rem)] flex-col gap-1 rounded-xl p-1"
      style={{ left: style.left, top: style.top }}
      role="toolbar"
      aria-label={t("viewer.selection.title")}
    >
      <div className="flex items-center gap-0.5">
        <IconButton icon={Copy} label={t("viewer.selection.copy")} onClick={copy} />
        {codeBlock ? (
          <div className="relative">
            <IconButton icon={Braces} label={t("viewer.selection.copyAsCode")} onClick={() => void copyAsCode()} />
            {codeBlock.language ? <span className="pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-muted px-1 text-[9px] leading-none text-muted-foreground">{codeBlock.language}</span> : null}
          </div>
        ) : null}
        <IconButton icon={Quote} label={t("viewer.context.copyQuotation")} onClick={() => void copyAsQuotation()} />
        <IconButton icon={Volume2} label={t("viewer.selection.readAloud")} onClick={speak} />
        <IconButton icon={Languages} label={t("viewer.selection.translate")} onClick={translate} />
        <IconButton icon={SquareDashed} label={t("viewer.selection.redact")} disabled={busy} onClick={() => void redact()} />
        <IconButton icon={Link2} label={t("viewer.selection.link")} active={linkOpen} onClick={() => setLinkOpen((state) => !state)} />
        <IconButton icon={X} label={t("common.close")} onClick={dismiss} />
      </div>
      {linkOpen ? (
        <form
          noValidate
          className="flex items-center gap-1.5 border-t border-(--chip-ring) px-1 pb-0.5 pt-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void link();
          }}
        >
          <input
            autoFocus
            type="text"
            inputMode="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://"
            aria-label={t("viewer.overlay.linkUrl")}
            className="field h-7 min-w-0 flex-1 rounded-lg px-2 font-mono text-xs"
          />
          <button
            type="submit"
            disabled={busy || !linkUrl.trim()}
            className="glass-chip h-7 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-primary disabled:opacity-40"
          >
            {t("viewer.overlay.linkAdd")}
          </button>
        </form>
      ) : null}
    </div>,
    window.document.body,
  );
}
