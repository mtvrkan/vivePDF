import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  BookmarkPlus,
  Braces,
  Camera,
  Copy,
  Edit3,
  ExternalLink,
  FileImage,
  FileOutput,
  FileSearch,
  FileText,
  Globe,
  Hash,
  Image as ImageIcon,
  ImageDown,
  Images,
  Languages,
  Link2,
  Pilcrow,
  Printer,
  Quote,
  RotateCcw,
  RotateCw,
  Search,
  Volume2,
  ScanSearch,
  ScanText,
  TextSelect,
  ZoomIn,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { TextInput } from "@/components/tool/form";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { join, tempDir } from "@tauri-apps/api/path";
import { Select } from "@/components/shared/Select";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { useRotate } from "@embedpdf/plugin-rotate/react";
import { useZoomCapability } from "@embedpdf/plugin-zoom/react";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { reindentLines } from "@/shared/lib/codeReindent";
import { cleanCopiedText, reflowParagraphs } from "@/shared/lib/copyText";
import { pageLabelOf } from "@/shared/lib/pageLabels";
import { usePageLabels } from "@/shared/store/pageLabelsStore";
import { describeError } from "@/shared/lib/errorMessage";
import { openExternal } from "@/shared/lib/openExternal";
import { basenameOf, dirnameOf, joinPath, pageFileUrl, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { defineUrl, scholarUrl, searchUrl, translateUrl, wikipediaUrl } from "@/shared/lib/webSearch";
import { toRpcError } from "@/shared/rpc/client";
import { assemblePages, convertToImages, getCodeBlocks, imageAt, imageSave } from "@/shared/rpc/operations";
import { openProducedPicture, searchPictureWithLens } from "@/shared/rpc/files";
import { renderThumbnail } from "@/shared/rpc/thumbnail";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { useSearchRequestStore } from "@/shared/store/searchRequestStore";
import { useSpeechStore } from "@/shared/store/speechStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { requestSearchable } from "./searchableStore";
import { arrangeMenu, menuFocus, pointOnRects, type PageRect } from "./contextMenuLayout";
import { bookmarkTitleFrom } from "./bookmarkTitle";
import { usePageNavigation } from "./usePageNavigation";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { useTranslationStore } from "@/shared/store/translationStore";
import { useWebSearchStore } from "@/shared/store/webSearchStore";
import { visiblePageSize } from "./overlay/pageSize";
import { frameSizePx, quarterTurns, screenToFrame } from "./overlay/pageFrame";
import type { ImageAtResult } from "@/types";

const PAGE_EXPORT_WIDTH = 1600;
const PAGE_PNG_DPI = [72, 96, 150, 200, 300, 600];
const DEFAULT_PAGE_PNG_DPI = 150;
const VIEWABLE_PICTURE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const TYPING_TARGETS = "input, textarea, [data-editor-input]";
const SECONDARY_BUTTON = 2;
const SECONDARY_BUTTON_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup"] as const;

type SelectionRect = { x: number; y: number; width: number; height: number };

function toSelectionRect(rect: PageRect): SelectionRect {
  return { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height };
}

function rectsOverlap(a: SelectionRect, b: [number, number, number, number]): boolean {
  const [bx, by, bw, bh] = b;
  return a.x < bx + bw && a.x + a.width > bx && a.y < by + bh && a.y + a.height > by;
}

type MenuState = { x: number; y: number; page: number; pageX: number; pageY: number; selectionText: string; onSelection: boolean };

type BookmarkRequest = { page: number; x: number; y: number; title: string };

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export function ViewerContextMenu({ documentId, hostRef }: { documentId: string; hostRef: RefObject<HTMLDivElement | null> }) {
  const { t, i18n } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const labels = usePageLabels(documentId);
  const { provides: selection } = useSelectionCapability();
  const { provides: zoom } = useZoomCapability();
  const { provides: rotate, rotation: viewRotation } = useRotate(documentId);
  const { jumpTo } = usePageNavigation(documentId);
  const setPrintOpen = usePrintDialogStore((state) => state.setOpen);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [image, setImage] = useState<ImageAtResult | null | "loading">(null);
  const [busy, setBusy] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToValue, setGoToValue] = useState("");
  const [pngRequest, setPngRequest] = useState<{ page: number } | null>(null);
  const [pngDpi, setPngDpi] = useState(String(DEFAULT_PAGE_PNG_DPI));
  const [bookmarkRequest, setBookmarkRequest] = useState<BookmarkRequest | null>(null);
  const queueChange = usePendingChangesStore((state) => state.queue);
  const requestRef = useRef(0);
  const requestSearch = useSearchRequestStore((state) => state.requestSearch);
  const setPanels = useViewerPanelsStore((state) => state.setPanels);
  const webSearch = useWebSearchStore();
  const requestFocusAt = useViewerOverlayStore((state) => state.requestFocusAt);
  const setOverlayMode = useViewerOverlayStore((state) => state.setMode);
  const requestAreaText = useViewerOverlayStore((state) => state.requestAreaText);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(TYPING_TARGETS)) return;
      const pageElement = target?.closest<HTMLElement>("[data-page-index]");
      if (!pageElement) return;
      event.preventDefault();
      const pageIndex = Number(pageElement.dataset.pageIndex);
      const rect = pageElement.getBoundingClientRect();
      const page = visiblePageSize(documentId, pageIndex, rect.width, rect.height);
      const viewTurns = quarterTurns(viewRotation, "quarters");
      const scale = frameSizePx(viewTurns, rect.width, rect.height).width / page.width;
      const local = screenToFrame(event.clientX, event.clientY, rect, viewTurns);
      const state: MenuState = {
        x: event.clientX,
        y: event.clientY,
        page: pageIndex + 1,
        pageX: local.x / scale,
        pageY: local.y / scale,
        selectionText: "",
        onSelection: false,
      };
      setMenu(state);
      setImage("loading");
      const scope = selection?.forDocument(documentId);
      if (scope) {
        void scope
          .getSelectedText()
          .toPromise()
          .then((selected) => {
            const pageRects = (scope.getHighlightRects() as Record<string, PageRect[]> | undefined)?.[pageIndex] ?? [];
            const selectionText = pageRects.length > 0 ? cleanCopiedText(selected) : "";
            const onSelection = selectionText !== "" && pointOnRects(pageRects, state.pageX, state.pageY);
            setMenu((current) => (current ? { ...current, selectionText, onSelection } : current));
          })
          .catch(() => undefined);
      }
    };
    const keepSelectionOnSecondaryButton = (event: MouseEvent) => {
      if (event.button !== SECONDARY_BUTTON) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !host.contains(target) || target.closest(TYPING_TARGETS)) return;
      event.stopPropagation();
    };
    host.addEventListener("contextmenu", onContextMenu);
    for (const type of SECONDARY_BUTTON_EVENTS) window.addEventListener(type, keepSelectionOnSecondaryButton, true);
    return () => {
      host.removeEventListener("contextmenu", onContextMenu);
      for (const type of SECONDARY_BUTTON_EVENTS) window.removeEventListener(type, keepSelectionOnSecondaryButton, true);
    };
  }, [hostRef, documentId, selection, viewRotation]);

  const menuPage = menu?.page;
  const menuPageX = menu?.pageX;
  const menuPageY = menu?.pageY;

  useEffect(() => {
    if (menuPage === undefined || menuPageX === undefined || menuPageY === undefined || !document) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    void imageAt({ path: document.path, password: document.password ?? undefined, page: menuPage, x: menuPageX, y: menuPageY })
      .then((result) => {
        if (requestRef.current === request) setImage(result);
      })
      .catch(() => {
        if (requestRef.current === request) setImage({ found: false });
      });
  }, [menuPage, menuPageX, menuPageY, document]);

  useEffect(() => {
    if (!menu) return;
    const onBlur = () => setMenu(null);
    window.addEventListener("blur", onBlur, { once: true });
    return () => window.removeEventListener("blur", onBlur);
  }, [menu]);

  const close = useCallback(() => setMenu(null), []);

  const submitGoTo = () => {
    const target = Number.parseInt(goToValue, 10);
    setGoToOpen(false);
    if (Number.isFinite(target)) jumpTo(target);
  };

  const submitPagePng = async () => {
    const request = pngRequest;
    setPngRequest(null);
    if (!request || !document) return;
    const suggested = joinPath(dirnameOf(document.path), `${stemOf(document.path)}-${t("viewer.context.pageSuffix")}-${request.page}.png`);
    const chosen = await saveDialog({ defaultPath: suggested, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await convertToImages({
        path: document.path,
        password: document.password ?? undefined,
        outputDir: dirnameOf(chosen),
        baseName: stemOf(chosen),
        pages: String(request.page),
        format: "png",
        dpi: Number(pngDpi),
        single: true,
        overwrite: true,
      });
      toast("success", t("viewer.context.pagePngSaved", { name: basenameOf(result.outputs[0] ?? chosen) }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const submitBookmark = () => {
    const request = bookmarkRequest;
    const title = request?.title.trim() ?? "";
    if (!request || !title) return;
    setBookmarkRequest(null);
    queueChange(documentId, { kind: "bookmarkAdded", title, page: request.page, x: request.x, y: request.y, label: title });
    toast("info", t("viewer.context.bookmarkQueued", { title }));
  };

  const dialogs = (
    <>
      <Dialog
        open={bookmarkRequest !== null}
        title={t("viewer.context.addBookmarkTitle", { page: bookmarkRequest?.page ?? 1 })}
        onClose={() => setBookmarkRequest(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setBookmarkRequest(null)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" disabled={!bookmarkRequest?.title.trim()} onClick={submitBookmark}>
              {t("viewer.context.addBookmarkConfirm")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitBookmark();
          }}
        >
          <TextInput
            autoFocus
            value={bookmarkRequest?.title ?? ""}
            maxLength={500}
            onChange={(event) => setBookmarkRequest((current) => (current ? { ...current, title: event.target.value } : current))}
            aria-label={t("viewer.context.bookmarkName")}
            className="w-full"
          />
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{t("viewer.context.addBookmarkHint")}</p>
      </Dialog>
      <Dialog
        open={goToOpen}
        title={t("viewer.context.goToPagePrompt")}
        onClose={() => setGoToOpen(false)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setGoToOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={submitGoTo}>
              {t("viewer.context.goToPage")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitGoTo();
          }}
        >
          <TextInput
            autoFocus
            type="number"
            min={1}
            value={goToValue}
            onChange={(event) => setGoToValue(event.target.value)}
            aria-label={t("viewer.pageNumber")}
            className="w-28 font-mono"
          />
        </form>
      </Dialog>
      <Dialog
        open={pngRequest !== null}
        title={t("viewer.context.savePagePngTitle", { page: pngRequest?.page ?? 1 })}
        onClose={() => setPngRequest(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setPngRequest(null)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void submitPagePng()}>
              {t("viewer.context.savePagePngConfirm")}
            </Button>
          </>
        }
      >
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>{t("viewer.context.pagePngDpi")}</span>
          <Select size="sm" mono value={pngDpi} options={PAGE_PNG_DPI.map((value) => ({ value: String(value), label: `${value} dpi` }))} onChange={setPngDpi} ariaLabel={t("viewer.context.pagePngDpi")} className="w-32" />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">{t("viewer.context.pagePngHint")}</p>
      </Dialog>
    </>
  );

  if (!menu || !document) return dialogs;
  const found = image !== "loading" && image !== null && image.found;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(menu.selectionText);
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const copyAsParagraph = async () => {
    try {
      await navigator.clipboard.writeText(reflowParagraphs(menu.selectionText));
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const copyAsQuotation = async () => {
    try {
      await navigator.clipboard.writeText(t("viewer.context.quotation", { text: reflowParagraphs(menu.selectionText), page: pageLabelOf(labels, menu.page) }));
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const copyAsMarkdown = async () => {
    try {
      const markdown = menu.selectionText
        .split("\n")
        .map((line) => (/^[-*•]\s/.test(line) ? `- ${line.replace(/^[-*•]\s/, "")}` : line))
        .join("\n");
      await navigator.clipboard.writeText(markdown);
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const copyAsCode = async () => {
    if (!document) return;
    const scope = selection?.forDocument(documentId);
    const pageIndex = menu.page - 1;
    const rects = ((scope?.getHighlightRects() as Record<string, PageRect[]> | undefined)?.[pageIndex] ?? []).map(toSelectionRect);
    try {
      const result = await getCodeBlocks({ path: document.path, password: document.password ?? undefined, page: pageIndex, visible: true });
      const selectionBox = rects.reduce<SelectionRect | null>((box, rect) => {
        if (!box) return rect;
        const x = Math.min(box.x, rect.x);
        const y = Math.min(box.y, rect.y);
        const right = Math.max(box.x + box.width, rect.x + rect.width);
        const bottom = Math.max(box.y + box.height, rect.y + rect.height);
        return { x, y, width: right - x, height: bottom - y };
      }, null);
      const matched = selectionBox ? result.blocks.filter((block) => rectsOverlap(selectionBox, block.bbox)) : [];
      const code = matched.length > 0 ? matched.map((block) => block.text).join("\n\n") : reindentLines(menu.selectionText.split("\n"), rects).join("\n");
      await navigator.clipboard.writeText(code);
      toast("success", t("viewer.context.codeCopied"));
    } catch {
      const fallback = reindentLines(menu.selectionText.split("\n"), rects).join("\n");
      try {
        await navigator.clipboard.writeText(fallback);
        toast("success", t("viewer.context.codeCopied"));
      } catch {
        toast("error", t("viewer.context.copyFailed"));
      }
    }
  };

  const searchInDocument = () => {
    requestSearch(menu.selectionText);
    setPanels((panels) => ({ ...panels, search: true }));
  };

  const openWebSearch = async (url: string) => {
    try {
      await openExternal(url);
    } catch {
      toast("error", t("viewer.link.openFailed"));
    }
  };

  const translateSelection = () => {
    useTranslationStore.getState().request(reflowParagraphs(menu.selectionText));
    setPanels((panels) => ({ ...panels, translate: true }));
  };

  const readAloud = () => {
    if (!useSpeechStore.getState().speak(reflowParagraphs(menu.selectionText), { lang: locale, owner: "selection" })) {
      toast("error", t("viewer.selection.readAloudUnavailable"));
    }
  };

  const copyImage = async () => {
    if (!found || !image.pngBase64) return;
    setBusy(true);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": base64ToBlob(image.pngBase64, "image/png") })]);
      toast("success", t("viewer.context.imageCopied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const searchWithLens = async () => {
    if (!found || !image.pngBase64) return;
    setBusy(true);
    try {
      const picture = await createImageBitmap(base64ToBlob(image.pngBase64, "image/png"));
      const { width, height } = picture;
      picture.close();
      await searchPictureWithLens(image.pngBase64, width, height);
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const editImage = () => {
    setOverlayMode("image");
    requestFocusAt({ page: menu.page, x: menu.pageX, y: menu.pageY });
  };

  const saveImage = async () => {
    if (!found) return;
    const ext = image.ext ?? "png";
    const suggested = joinPath(dirnameOf(document.path), `${stemOf(document.path)}-${t("viewer.context.imageSuffix")}-${menu.page}.${ext}`);
    const chosen = await saveDialog({ defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "PNG", extensions: ["png"] }] });
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await imageSave({ path: document.path, password: document.password ?? undefined, page: menu.page, x: menu.pageX, y: menu.pageY, output: chosen, overwrite: true });
      toast("success", t("viewer.context.imageSaved", { name: basenameOf(result.output) }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const openPictureInDefaultApp = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const folder = await join(await tempDir(), "vivepdf-pictures");
      const ext = image.ext && VIEWABLE_PICTURE_EXTENSIONS.has(image.ext) ? image.ext : "png";
      const output = await join(folder, `${stemOf(document.path)}-${t("viewer.context.imageSuffix")}-${menu.page}-${Date.now()}.${ext}`);
      const result = await imageSave({ path: document.path, password: document.password ?? undefined, page: menu.page, x: menu.pageX, y: menu.pageY, output, overwrite: true });
      await openProducedPicture(result.output);
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const zoomToArea = () => {
    zoom?.toggleMarqueeZoom();
  };

  const copyPageAsImage = async () => {
    setBusy(true);
    try {
      const result = await renderThumbnail({ path: document.path, password: document.password ?? undefined, page: menu.page - 1, width: PAGE_EXPORT_WIDTH });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": base64ToBlob(result.image, "image/png") })]);
      toast("success", t("viewer.context.imageCopied"));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const extractPageAsPdf = async () => {
    const suggested = suggestOutputPath(document.path, `${t("viewer.context.pageSuffix")}-${menu.page}`);
    const chosen = await saveDialog({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!chosen) return;
    setBusy(true);
    try {
      await assemblePages({
        sources: [{ id: "main", path: document.path, password: document.password ?? undefined }],
        pages: [{ kind: "page", source: "main", index: menu.page, rotate: 0 }],
        output: chosen,
        overwrite: true,
      });
      toast("success", t("viewer.context.pageExtracted", { name: basenameOf(chosen) }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const rotateViewForward = () => rotate?.rotateForward();
  const rotateViewBackward = () => rotate?.rotateBackward();

  const printThisPage = () => setPrintOpen(true, String(menu.page));

  const goToPage = () => {
    setGoToValue(String(menu.page));
    setGoToOpen(true);
  };

  const addBookmarkHere = () => {
    const title = bookmarkTitleFrom(menu.selectionText) || t("viewer.context.bookmarkDefaultTitle", { page: menu.page });
    setBookmarkRequest({ page: menu.page, x: menu.pageX, y: menu.pageY, title });
  };

  const copyLinkToPage = async () => {
    try {
      await navigator.clipboard.writeText(pageFileUrl(document.path, menu.page));
      toast("success", t("viewer.selection.copied"));
    } catch {
      toast("error", t("viewer.context.copyFailed"));
    }
  };

  const locale = i18n.language;
  const configuredEngineUrl = searchUrl(webSearch.engine, menu.selectionText, webSearch.customUrl);

  const webSearchItems: ContextMenuItem[] = [
    { type: "item", id: "web-default", label: t("viewer.context.webSearchDefault"), onSelect: () => void openWebSearch(configuredEngineUrl) },
    { type: "separator", id: "sep-web" },
    { type: "item", id: "web-google", label: "Google", onSelect: () => void openWebSearch(searchUrl("google", menu.selectionText)) },
    { type: "item", id: "web-bing", label: "Bing", onSelect: () => void openWebSearch(searchUrl("bing", menu.selectionText)) },
    { type: "item", id: "web-ddg", label: "DuckDuckGo", onSelect: () => void openWebSearch(searchUrl("duckduckgo", menu.selectionText)) },
    { type: "item", id: "web-scholar", label: t("viewer.context.googleScholar"), onSelect: () => void openWebSearch(scholarUrl(menu.selectionText)) },
    { type: "item", id: "web-wikipedia", label: "Wikipedia", onSelect: () => void openWebSearch(wikipediaUrl(menu.selectionText, locale)) },
    { type: "item", id: "web-define", label: t("viewer.context.define"), onSelect: () => void openWebSearch(defineUrl(menu.selectionText, locale)) },
  ];

  const readImageText = () => {
    const rect = image !== "loading" && image !== null ? image.rect : null;
    if (!rect || rect.length < 4) return;
    requestAreaText({ pageIndex: menu.page - 1, x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] });
    close();
  };

  const selectionItems: ContextMenuItem[] = menu.selectionText
    ? [
        { type: "item", id: "copy-text", icon: Copy, label: t("viewer.context.copyText"), onSelect: () => void copyText() },
        {
          type: "submenu",
          id: "copy-as",
          icon: Pilcrow,
          label: t("viewer.context.copyAs"),
          items: [
            { type: "item", id: "copy-paragraph", icon: Pilcrow, label: t("viewer.context.copyParagraph"), onSelect: () => void copyAsParagraph() },
            { type: "item", id: "copy-quotation", icon: Quote, label: t("viewer.context.copyQuotation"), onSelect: () => void copyAsQuotation() },
            { type: "item", id: "copy-markdown", icon: FileSearch, label: t("viewer.context.copyMarkdown"), onSelect: () => void copyAsMarkdown() },
            { type: "item", id: "copy-code", icon: Braces, label: t("viewer.context.copyAsCode"), onSelect: () => void copyAsCode() },
          ],
        },
        { type: "separator", id: "sep-selection-copy" },
        { type: "item", id: "search-doc", icon: Search, label: t("viewer.context.searchInDocument"), onSelect: searchInDocument },
        { type: "submenu", id: "search-web", icon: Globe, label: t("viewer.context.searchWeb"), items: webSearchItems },
        {
          type: "submenu",
          id: "translate-menu",
          icon: Languages,
          label: t("viewer.context.translate"),
          items: [
            { type: "item", id: "translate", icon: Languages, label: t("viewer.context.offlineTranslator"), onSelect: translateSelection },
            { type: "item", id: "translate-google", icon: Globe, label: t("viewer.context.googleTranslate"), onSelect: () => void openWebSearch(translateUrl(menu.selectionText, locale)) },
          ],
        },
        { type: "item", id: "read-aloud", icon: Volume2, label: t("viewer.selection.readAloud"), onSelect: readAloud },
      ]
    : [];

  const pictureItems: ContextMenuItem[] = found
    ? [
        { type: "item", id: "copy-image", icon: Images, label: t("viewer.context.copyImage"), disabled: busy, onSelect: () => void copyImage() },
        { type: "item", id: "save-image", icon: ImageDown, label: t("viewer.context.saveImage"), disabled: busy, onSelect: () => void saveImage() },
        { type: "item", id: "open-image", icon: ExternalLink, label: t("viewer.context.openImageExternally"), disabled: busy, onSelect: () => void openPictureInDefaultApp() },
        { type: "separator", id: "sep-picture-files" },
        { type: "item", id: "lens", icon: ImageIcon, label: t("viewer.context.searchLens"), disabled: busy, onSelect: () => void searchWithLens() },
        { type: "item", id: "image-text", icon: ScanText, label: t("viewer.context.copyImageText"), onSelect: readImageText },
        { type: "item", id: "edit-image", icon: Edit3, label: t("viewer.context.editImage"), onSelect: editImage },
      ]
    : [];

  const pageItems: ContextMenuItem[] = [
    { type: "item", id: "go-to-page", icon: Hash, label: t("viewer.context.goToPage"), onSelect: goToPage },
    { type: "item", id: "add-bookmark", icon: BookmarkPlus, label: t("viewer.context.addBookmark"), onSelect: addBookmarkHere },
    { type: "item", id: "copy-page-link", icon: Link2, label: t("viewer.context.copyPageLink"), onSelect: () => void copyLinkToPage() },
    { type: "item", id: "print-page", icon: Printer, label: t("viewer.context.printThisPage"), onSelect: printThisPage },
    { type: "separator", id: "sep-page-groups" },
    {
      type: "submenu",
      id: "page-export",
      icon: FileOutput,
      label: t("viewer.context.exportPage"),
      items: [
        { type: "item", id: "copy-page-image", icon: Images, label: t("viewer.context.copyPageImage"), disabled: busy, onSelect: () => void copyPageAsImage() },
        { type: "item", id: "save-page-png", icon: FileImage, label: t("viewer.context.savePagePng"), disabled: busy, onSelect: () => setPngRequest({ page: menu.page }) },
        { type: "item", id: "extract-page", icon: FileOutput, label: t("viewer.context.extractPage"), disabled: busy, onSelect: () => void extractPageAsPdf() },
        { type: "item", id: "snapshot", icon: Camera, label: t("viewer.snapshot.tool"), onSelect: () => setOverlayMode("snapshot") },
      ],
    },
    {
      type: "submenu",
      id: "page-view",
      icon: ZoomIn,
      label: t("viewer.context.view"),
      items: [
        { type: "item", id: "zoom-area", icon: ZoomIn, label: t("viewer.context.zoomToArea"), onSelect: zoomToArea },
        { type: "item", id: "rotate-forward", icon: RotateCw, label: t("viewer.context.rotateViewForward"), onSelect: rotateViewForward },
        { type: "item", id: "rotate-backward", icon: RotateCcw, label: t("viewer.context.rotateViewBackward"), onSelect: rotateViewBackward },
      ],
    },
    {
      type: "submenu",
      id: "page-selectable",
      icon: ScanSearch,
      label: t("viewer.context.makeSelectable"),
      items: [
        { type: "item", id: "searchable-page", icon: ScanText, label: t("viewer.searchable.thisPage"), onSelect: () => requestSearchable({ pageIndex: menu.page - 1 }) },
        { type: "item", id: "searchable-document", icon: ScanSearch, label: t("viewer.searchable.wholeDocument"), onSelect: () => requestSearchable("document") },
      ],
    },
  ];

  const items = arrangeMenu(
    [
      { id: "selection", label: t("viewer.context.selectionGroup"), icon: TextSelect, items: selectionItems },
      { id: "picture", label: t("viewer.context.pictureGroup"), icon: ImageIcon, items: pictureItems },
      { id: "page", label: t("viewer.context.pageGroup"), icon: FileText, items: pageItems },
    ],
    menuFocus({ onSelection: menu.onSelection, hasPicture: found }),
  );

  return (
    <>
      <ContextMenu anchor={{ x: menu.x, y: menu.y }} items={items} label={t("viewer.context.title")} onClose={close} />
      {dialogs}
    </>
  );
}
