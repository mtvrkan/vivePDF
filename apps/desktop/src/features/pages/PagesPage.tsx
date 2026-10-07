import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { FileOutput, FilePlus2, History, LayoutGrid, Move, RotateCw, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useScrollCapability } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { DocumentEmptyState } from "@/components/shared/DocumentEmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { IconButton } from "@/components/shared/IconButton";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useLiveActiveDocument } from "@/features/viewer/useLiveActiveDocument";
import { useOperation } from "@/shared/hooks/useOperation";
import { dirnameOf, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { assemblePageParts, assemblePages } from "@/shared/rpc/operations";
import { isPdfPath } from "@/shared/rpc/files";
import { useMarqueeSelection, type MarqueeBox, type TileRect } from "./useMarqueeSelection";
import { useVirtualGrid } from "./useVirtualGrid";
import { clickSelection, tileClickAction, type ClickMode } from "./tileSelection";
import { usePagePreview } from "./usePagePreview";
import { duplexOrder, labelRules, positionsToKeys, tileLabelTexts } from "./organizerTools";
import { DuplexDialog, MovePagesDialog, PageLabelDialog, PagePreviewDialog, RangeSelectDialog, type DuplexChoice } from "./OrganizerDialogs";
import { ContextMenu } from "@/components/shared/ContextMenu";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { AssemblePage, AssembleSource, OrganizerSource, OrganizerTile } from "@/types";
import { DocumentTabs } from "@/features/viewer/DocumentTabs";
import { Dialog } from "@/components/shared/Dialog";
import { PageTile, type TileActions } from "./PageTile";
import { InsertBlankDialog, InsertPdfDialog, ShortcutsDialog, SourcePasswordDialog } from "./InsertDialogs";
import { useRestoredSources } from "./useRestoredSources";
import { MAIN_SOURCE_ID, cutStarts, isDirty, moveTiles, rotateBy, tileKey, useOrganizerStore } from "./organizerStore";
import { isImagePath, useInsertSources } from "./useInsertSources";
import { useTileDrag } from "./useTileDrag";
import { useOrganizerEdits } from "./useOrganizerEdits";
import { usePageInspections } from "./usePageInspections";
import { useOrganizerShortcuts } from "./useOrganizerShortcuts";
import { tileMenuItems } from "./organizerMenu";
import { OrganizerToolbar, SelectionBar } from "./OrganizerToolbar";
import { OrganizerOutput } from "./OrganizerOutput";
import { DragBadge, MarqueeRect } from "./LiveOverlays";
import { usePageClipboardActions } from "./usePageClipboardActions";
import { usePageClipboard } from "./pageClipboard";

type TileMenu = { x: number; y: number; key: string };

const TILE_CHROME_HEIGHT = 48;

export function PagesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const zoom = useUiStore((state) => state.pagesZoom);
  const setZoom = useUiStore((state) => state.setPagesZoom);
  const { activeDocumentId } = useLiveActiveDocument();
  const document = useDocumentStore((state) => (activeDocumentId ? (state.documents[activeDocumentId] ?? null) : null));
  const { pickAndOpen, openPath } = useOpenPdf();
  const pushToast = useToastStore((state) => state.push);
  const { provides: scrollCapability } = useScrollCapability();
  const operation = useOperation(assemblePages);
  const partsOperation = useOperation(assemblePageParts);
  const { loadPdfSource, imageTiles, pageTiles } = useInsertSources();
  const restoredSources = useRestoredSources();

  const organizerDocumentId = useOrganizerStore((state) => state.documentId);
  const tiles = useOrganizerStore((state) => state.tiles);
  const initialTiles = useOrganizerStore((state) => state.initialTiles);
  const sources = useOrganizerStore((state) => state.sources);
  const selected = useOrganizerStore((state) => state.selected);
  const anchor = useOrganizerStore((state) => state.anchor);
  const initialize = useOrganizerStore((state) => state.initialize);
  const clear = useOrganizerStore((state) => state.clear);
  const commit = useOrganizerStore((state) => state.commit);
  const select = useOrganizerStore((state) => state.select);
  const reset = useOrganizerStore((state) => state.reset);
  const cuts = useOrganizerStore((state) => state.cuts);
  const labels = useOrganizerStore((state) => state.labels);

  const [output, setOutput] = useState("");
  const [blankOpen, setBlankOpen] = useState(false);
  const [pdfToInsert, setPdfToInsert] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [resultKind, setResultKind] = useState<"single" | "parts">("single");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [duplexOpen, setDuplexOpen] = useState(false);
  const [labelTarget, setLabelTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<TileMenu | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const gridRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasDocument = Boolean(activeDocumentId && document);
  const tileHeight = Math.round(zoom * 1.3);
  const grid = useVirtualGrid({ mounted: hasDocument, scrollRef, gridRef, count: tiles.length, minColumnWidth: zoom, rowHeight: tileHeight + TILE_CHROME_HEIGHT });

  const edits = useOrganizerEdits(grid.revealIndex);
  const { setLabels, insertAtSelection, replaceSelection, selectAndReveal } = edits;
  const inspections = usePageInspections(activeDocumentId, edits);
  const clipboard = usePageClipboardActions(edits);
  const preview = usePagePreview(edits);
  const { previewKey, close: closePreview } = preview;
  const canPaste = usePageClipboard((state) => state.tiles.length > 0);

  const pageCount = document?.info?.pageCount ?? 0;

  useEffect(() => {
    if (!activeDocumentId || !document || pageCount === 0) {
      if (!activeDocumentId) clear();
      return;
    }
    if (organizerDocumentId !== activeDocumentId) {
      initialize({ id: MAIN_SOURCE_ID, path: document.path, password: document.password, fileName: document.fileName, embedDocId: activeDocumentId, pageCount });
    }
  }, [activeDocumentId, document, pageCount, organizerDocumentId, initialize, clear]);

  useEffect(() => {
    if (document) setOutput(suggestOutputPath(document.path, t("tools.pages.suffix")));
  }, [document, t]);

  const resetOperation = operation.reset;
  const resetPartsOperation = partsOperation.reset;

  useEffect(() => {
    resetOperation();
    resetPartsOperation();
    closePreview();
    setMenu(null);
    setResultKind("single");
  }, [activeDocumentId, resetOperation, resetPartsOperation, closePreview]);

  const labelTexts = useMemo(() => tileLabelTexts(tiles, labels), [tiles, labels]);
  const dirty = useMemo(() => isDirty(tiles, initialTiles) || labelTexts !== null, [tiles, initialTiles, labelTexts]);
  const selectedCount = selected.size;
  const partStarts = useMemo(() => cutStarts(tiles, cuts), [tiles, cuts]);
  const busy = operation.running || partsOperation.running;

  const onMove = useCallback((keys: Set<string>, dropIndex: number) => commit(moveTiles(useOrganizerStore.getState().tiles, keys, dropIndex)), [commit]);
  const { drag, dropIndex, pointer: dragPointer, onTilePointerDown, wasDragged } = useTileDrag({ scrollRef, dropIndexAt: grid.dropIndexAtClient, selectedKeys: selected, onMove });

  const applyClick = (key: string, mode: ClickMode) => {
    const next = clickSelection(tiles, selected, anchor, key, mode);
    select(next.keys, next.anchor);
  };

  const clickTile = (event: MouseEvent, key: string) => {
    if (event.detail > 1) return;
    const action = tileClickAction(event, multiSelect, wasDragged());
    if (action.kind === "select") applyClick(key, action.mode);
  };

  const checkTile = (event: MouseEvent, key: string) => {
    event.stopPropagation();
    applyClick(key, event.shiftKey ? "rangeAdd" : "toggle");
  };

  const insertFiles = useCallback(
    async (paths: string[]) => {
      const images = paths.filter(isImagePath);
      const pdfs = paths.filter(isPdfPath);
      if (images.length > 0) insertAtSelection(await imageTiles(images));
      for (const pdf of pdfs) {
        const load = await loadPdfSource(pdf, null);
        if (load.status === "ready") {
          insertAtSelection(pageTiles(load.source, Array.from({ length: load.source.pageCount }, (_, index) => index + 1)));
        } else if (load.status === "password") {
          setReplacing(false);
          setPdfToInsert(pdf);
        }
      }
    },
    [imageTiles, loadPdfSource, pageTiles, insertAtSelection],
  );

  useEffect(() => {
    const setHandler = useDropTargetStore.getState().setHandler;
    if (!activeDocumentId) return;
    setHandler((paths) => void insertFiles(paths));
    return () => setHandler(null);
  }, [activeDocumentId, insertFiles]);

  const pickImages = async () => {
    const selectedPaths = await openDialog({ multiple: true, directory: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"] }] });
    if (!selectedPaths) return;
    await insertFiles(Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths]);
  };

  const pickPdf = async (replace: boolean) => {
    const selectedPath = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selectedPath !== "string") return;
    setReplacing(replace);
    setPdfToInsert(selectedPath);
  };

  const openInViewer = (tile: OrganizerTile) => {
    if (tile.kind !== "page" || tile.sourceId !== MAIN_SOURCE_ID || !activeDocumentId) return;
    void navigate("/viewer");
    window.setTimeout(() => scrollCapability?.forDocument(activeDocumentId).scrollToPage({ pageNumber: tile.index, behavior: "instant" }), 250);
  };

  const arrangement = useCallback(
    (chosen: OrganizerTile[]): { sources: AssembleSource[]; pages: AssemblePage[] } | null => {
      const state = useOrganizerStore.getState();
      if (!document) return null;
      const usedSources = new Set(chosen.filter((tile): tile is Extract<OrganizerTile, { kind: "page" }> => tile.kind === "page").map((tile) => tile.sourceId));
      const assembleSources: AssembleSource[] = Object.values(state.sources)
        .filter((source: OrganizerSource) => usedSources.has(source.id))
        .map((source) => ({ id: source.id, path: source.path, password: source.password ?? undefined }));
      const pages: AssemblePage[] = chosen.map((tile) =>
        tile.kind === "page"
          ? { kind: "page", source: tile.sourceId, index: tile.index, rotate: tile.rotate }
          : tile.kind === "blank"
            ? { kind: "blank", width: tile.width, height: tile.height, rotate: tile.rotate, ...(tile.paper ? { paper: tile.paper } : {}) }
            : { kind: "image", path: tile.path, rotate: tile.rotate },
      );
      return {
        sources: assembleSources.length > 0 ? assembleSources : [{ id: MAIN_SOURCE_ID, path: document.path, password: document.password ?? undefined }],
        pages,
      };
    },
    [document],
  );

  const apply = useCallback(
    (subset: boolean) => {
      const state = useOrganizerStore.getState();
      if (!document || !output) return;
      const chosen = subset ? state.tiles.filter((tile) => state.selected.has(tile.key)) : state.tiles;
      if (chosen.length === 0) return;
      const arranged = arrangement(chosen);
      if (!arranged) return;
      const rules = labelRules(chosen, labels);
      setResultKind("single");
      void operation.run({
        ...arranged,
        output: subset ? suggestOutputPath(document.path, t("tools.pages.extractSuffix")) : output,
        labels: rules.length > 0 ? rules : undefined,
      });
    },
    [document, output, operation, t, arrangement, labels],
  );

  const saveParts = useCallback(() => {
    const state = useOrganizerStore.getState();
    if (!output) return;
    const starts = cutStarts(state.tiles, cuts);
    if (starts.length === 0) return;
    const arranged = arrangement(state.tiles);
    if (!arranged) return;
    const rules = labelRules(state.tiles, labels);
    setResultKind("parts");
    void partsOperation.run({ ...arranged, cuts: starts, outputDir: dirnameOf(output), baseName: stemOf(output), labels: rules.length > 0 ? rules : undefined });
  }, [output, cuts, arrangement, partsOperation, labels]);

  const openMenu = useCallback(
    (key: string, x: number, y: number) => {
      if (!useOrganizerStore.getState().selected.has(key)) select([key], key);
      setMenu({ x, y, key });
    },
    [select],
  );

  const tileActionsRef = useRef<TileActions | null>(null);
  useLayoutEffect(() => {
    tileActionsRef.current = {
      pointerDown: onTilePointerDown,
      click: clickTile,
      check: checkTile,
      preview: preview.open,
      rotate: edits.rotateTile,
      remove: edits.deleteTile,
      menu: openMenu,
      toggleCut: edits.toggleCutAt,
    };
  });
  const tileActions = useMemo<TileActions>(
    () => ({
      pointerDown: (event, key) => tileActionsRef.current?.pointerDown(event, key),
      click: (event, key) => tileActionsRef.current?.click(event, key),
      check: (event, key) => tileActionsRef.current?.check(event, key),
      preview: (key) => tileActionsRef.current?.preview(key),
      rotate: (key, delta) => tileActionsRef.current?.rotate(key, delta),
      remove: (key) => tileActionsRef.current?.remove(key),
      menu: (key, x, y) => tileActionsRef.current?.menu(key, x, y),
      toggleCut: (key) => tileActionsRef.current?.toggleCut(key),
    }),
    [],
  );

  const dialogOpen = blankOpen || pdfToInsert !== null || shortcutsOpen || previewKey !== null || rangeOpen || moveOpen || duplexOpen || labelTarget !== null || menu !== null;
  useOrganizerShortcuts({
    enabled: Boolean(activeDocumentId) && !dialogOpen,
    layout: { columns: grid.columns, clientBoxOf: grid.clientBoxOf },
    edits,
    commands: {
      openRange: () => setRangeOpen(true),
      openMove: () => setMoveOpen(true),
      openPreview: preview.open,
      openMenu,
      openBlank: () => setBlankOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      extractSelection: () => apply(true),
      applyAll: () => apply(false),
      zoomBy: (delta) => setZoom(zoom + delta),
      copyPages: () => void clipboard.copyPages(),
      cutPages: clipboard.cutPages,
      pastePages: () => void clipboard.pastePages(),
    },
  });

  const applyDuplex = (choice: DuplexChoice) => {
    const current = useOrganizerStore.getState().tiles;
    const size = document?.info?.pageSizes[0] ?? { width: 595, height: 842 };
    const outcome = duplexOrder(current, { padding: choice.pad ? { width: size.width, height: size.height } : null, reverseBacks: choice.reverseBacks }, tileKey);
    commit(outcome.tiles, { cuts: choice.twoFiles && outcome.cutAfter ? new Set([outcome.cutAfter]) : new Set() });
    setDuplexOpen(false);
    pushToast("success", t(choice.twoFiles ? "tools.pages.duplex.doneTwoFiles" : "tools.pages.duplex.done"));
  };

  const selectPositions = (positions: number[]) => {
    selectAndReveal(positionsToKeys(tiles, positions));
    setRangeOpen(false);
  };

  const rotatePreview = useCallback(
    (delta: 90 | -90) => {
      const state = useOrganizerStore.getState();
      commit(state.tiles.map((tile) => (tile.key === previewKey ? { ...tile, rotate: rotateBy(tile.rotate, delta) } : tile)));
    },
    [commit, previewKey],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const { pagesZoom, setPagesZoom } = useUiStore.getState();
      setPagesZoom(pagesZoom - Math.sign(event.deltaY) * 20);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [hasDocument]);

  const { indexBoxesNear } = grid;
  const tilesNear = useCallback(
    (box: MarqueeBox): TileRect[] => {
      const current = useOrganizerStore.getState().tiles;
      return indexBoxesNear(box).flatMap(({ index, box: rect }) => (current[index] ? [{ key: current[index].key, rect }] : []));
    },
    [indexBoxesNear],
  );
  const { active: marqueeActive, box: marqueeBox, handlers: marqueeHandlers } = useMarqueeSelection({ scrollRef, gridRef, tilesNear, selected, onSelect: select });

  if (!activeDocumentId || !document) {
    return (
      <DocumentEmptyState
        icon={LayoutGrid}
        title={t("viewer.empty.title")}
        description={t("tools.pages.needDocument")}
        highlights={[
          { icon: Move, label: t("tools.pages.empty.reorder") },
          { icon: RotateCw, label: t("tools.pages.empty.rotate") },
          { icon: FilePlus2, label: t("tools.pages.empty.insert") },
        ]}
        onOpen={() => void pickAndOpen()}
        onOpenPath={(path) => void openPath(path)}
      />
    );
  }

  const matchSize = document.info?.pageSizes[0] ?? null;
  const previewPosition = previewKey ? tiles.findIndex((tile) => tile.key === previewKey) : -1;
  const previewTile = previewPosition >= 0 ? tiles[previewPosition] : null;
  const labelPosition = labelTarget ? tiles.findIndex((tile) => tile.key === labelTarget) : -1;
  const { range } = grid;
  const anchorPosition = anchor ? tiles.findIndex((tile) => tile.key === anchor) : -1;

  const confirmLeave = (run: () => void) => {
    if (!dirty) {
      run();
      return;
    }
    setPendingLeave(() => run);
  };

  return (
    <div data-tone="organize" className="flex h-full flex-col">
      <DocumentTabs confirmLeave={confirmLeave} />
      <PageHeader
        icon={LayoutGrid}
        tone="organize"
        eyebrow={t("tools.grid.groups.organize")}
        title={t("nav.pages")}
        description={`${document.fileName} · ${tiles.length} ${t("info.pages")} · ${selectedCount} ${t("tools.pages.selected")}`}
        actions={
          <>
            <IconButton icon={History} label={t("tools.pages.reset")} disabled={!dirty} onClick={reset} />
            <Button size="sm" icon={<FileOutput className="size-4" aria-hidden />} title={`${t("tools.pages.shortcut.extract")} (Ctrl+E)`} disabled={selectedCount === 0 || busy} onClick={() => apply(true)}>
              {t("tools.pages.extract")}
            </Button>
            {partStarts.length > 0 ? (
              <Button size="sm" icon={<Scissors className="size-4" aria-hidden />} disabled={busy} loading={partsOperation.running} onClick={saveParts}>
                {t("tools.pages.splitParts", { count: partStarts.length + 1 })}
              </Button>
            ) : null}
            <Button size="sm" variant="primary" title={`${t("tools.pages.shortcut.apply")} (Ctrl+Enter)`} disabled={!dirty || tiles.length === 0 || busy} loading={operation.running} onClick={() => apply(false)}>
              {t("tools.pages.apply")}
            </Button>
          </>
        }
      />
      <OrganizerToolbar
        edits={edits}
        inspections={inspections}
        multiSelect={multiSelect}
        pasting={clipboard.pasting}
        onToggleMultiSelect={() => setMultiSelect((current) => !current)}
        zoom={zoom}
        onZoom={setZoom}
        commands={{
          openRange: () => setRangeOpen(true),
          openDuplex: () => setDuplexOpen(true),
          openLabels: () => setLabelTarget(edits.focusTileKey()),
          openBlank: () => setBlankOpen(true),
          pickPdf: (replace) => void pickPdf(replace),
          pickImages: () => void pickImages(),
          openShortcuts: () => setShortcutsOpen(true),
          extractSelection: () => apply(true),
          pastePages: () => void clipboard.pastePages(),
        }}
      />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] md:grid-cols-[minmax(0,1fr)_var(--spacing-inspector)] md:grid-rows-1">
        <div ref={scrollRef} className="relative min-h-0 overflow-auto border-b p-4 md:border-e md:border-b-0" {...marqueeHandlers}>
          <ol
            ref={gridRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={t("nav.pages")}
            aria-activedescendant={anchorPosition >= range.start && anchorPosition < range.end ? `page-tile-${anchor}` : undefined}
            tabIndex={0}
            className="grid gap-3 outline-none"
            style={{ gridTemplateColumns: `repeat(${grid.metrics.columns}, minmax(${zoom}px, 1fr))`, gridAutoRows: `${grid.metrics.rowHeight}px`, paddingTop: grid.paddingTop, paddingBottom: grid.paddingBottom }}
          >
            {tiles.slice(range.start, range.end).map((tile, offset) => {
              const position = range.start + offset;
              const isSelected = selected.has(tile.key);
              const isLast = position === tiles.length - 1;
              return (
                <PageTile
                  key={tile.key}
                  tile={tile}
                  position={position}
                  total={tiles.length}
                  isLast={isLast}
                  isSelected={isSelected}
                  isCut={!isLast && cuts.has(tile.key)}
                  dropBefore={dropIndex === position}
                  dropAfter={dropIndex === tiles.length && isLast}
                  dimmed={Boolean(drag && (drag.key === tile.key || (isSelected && selected.has(drag.key))))}
                  labelText={labelTexts ? labelTexts[position] : null}
                  labelStart={Boolean(labels[tile.key])}
                  sources={sources}
                  width={zoom}
                  height={tileHeight}
                  actions={tileActions}
                />
              );
            })}
          </ol>
          <SelectionBar edits={edits} busy={busy} onExtract={() => apply(true)} onCopy={() => void clipboard.copyPages()} onCut={clipboard.cutPages} />
          {marqueeActive ? <MarqueeRect live={marqueeBox} /> : null}
          {drag ? <DragBadge live={dragPointer} label={`${drag.count} ${t("info.pages")}`} /> : null}
        </div>
        <OrganizerOutput
          output={output}
          onOutputChange={setOutput}
          busy={busy}
          resultKind={resultKind}
          operation={operation}
          partsOperation={partsOperation}
          sourcePassword={document?.password ?? undefined}
          onRetrySingle={() => apply(false)}
          onRetryParts={saveParts}
        />
      </div>
      <InsertBlankDialog
        open={blankOpen}
        onClose={() => setBlankOpen(false)}
        matchSize={matchSize}
        onInsert={(width, height, count, paper) => {
          insertAtSelection(Array.from({ length: count }, () => ({ key: tileKey(), kind: "blank", width, height, rotate: 0, ...(paper ? { paper } : {}) })));
          setBlankOpen(false);
        }}
      />
      <InsertPdfDialog
        path={pdfToInsert}
        replacing={replacing}
        onClose={() => {
          setPdfToInsert(null);
          useOrganizerStore.getState().pruneUnusedSources();
        }}
        onInsert={(source, pages) => {
          if (replacing) replaceSelection(pageTiles(source, pages));
          else insertAtSelection(pageTiles(source, pages));
          setPdfToInsert(null);
        }}
      />
      <SourcePasswordDialog request={restoredSources.request} busy={restoredSources.busy} onSubmit={(password) => void restoredSources.submit(password)} onSkip={restoredSources.skip} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PagePreviewDialog
        tile={previewTile}
        position={previewPosition}
        total={tiles.length}
        label={labelTexts && previewPosition >= 0 ? labelTexts[previewPosition] : null}
        sources={sources}
        selected={previewTile !== null && selected.has(previewTile.key)}
        selectedCount={selectedCount}
        onClose={closePreview}
        onStep={preview.step}
        onRotate={rotatePreview}
        onToggleSelect={preview.toggle}
        onOpenInViewer={
          previewTile?.kind === "page" && previewTile.sourceId === MAIN_SOURCE_ID
            ? () => {
                closePreview();
                openInViewer(previewTile);
              }
            : null
        }
      />
      <RangeSelectDialog open={rangeOpen} total={tiles.length} onClose={() => setRangeOpen(false)} onSelect={selectPositions} />
      <MovePagesDialog
        open={moveOpen}
        total={tiles.length}
        count={selected.size}
        onClose={() => setMoveOpen(false)}
        onMove={(position) => {
          setMoveOpen(false);
          edits.moveSelectedTo(position);
        }}
      />
      <DuplexDialog open={duplexOpen} total={tiles.length} onClose={() => setDuplexOpen(false)} onApply={applyDuplex} />
      <PageLabelDialog
        open={labelTarget !== null && labelPosition >= 0}
        position={labelPosition}
        current={labelTarget ? (labels[labelTarget] ?? null) : null}
        hasLabels={labelTexts !== null}
        onClose={() => setLabelTarget(null)}
        onApply={(label) => {
          if (labelTarget) setLabels((current) => ({ ...current, [labelTarget]: label }));
          setLabelTarget(null);
        }}
        onRemove={() => {
          if (labelTarget) setLabels((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== labelTarget)));
          setLabelTarget(null);
        }}
        onClearAll={() => {
          setLabels({});
          setLabelTarget(null);
        }}
      />
      {menu ? (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          items={tileMenuItems(menu.key, {
            t,
            tiles,
            selected,
            cuts,
            busy,
            canPaste: canPaste && !clipboard.pasting,
            onPreview: preview.open,
            onOpenInViewer: openInViewer,
            onRotate: edits.rotateSelected,
            onDuplicate: edits.duplicateSelected,
            onDelete: edits.deleteSelected,
            onCopy: () => void clipboard.copyPages(),
            onCut: clipboard.cutPages,
            onPaste: () => void clipboard.pastePages(),
            onToggleCut: edits.toggleCutAt,
            onExtract: () => apply(true),
            onInsertBlank: () => setBlankOpen(true),
            onLabel: setLabelTarget,
            onMove: () => setMoveOpen(true),
          })}
          label={t("tools.pages.menu.title")}
          onClose={closeMenu}
        />
      ) : null}
      <Dialog
        open={pendingLeave !== null}
        title={t("tools.pages.leaveTitle")}
        onClose={() => setPendingLeave(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setPendingLeave(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const run = pendingLeave;
                setPendingLeave(null);
                run?.();
              }}
            >
              {t("viewer.save.discard")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("tools.pages.leaveBody")}</p>
      </Dialog>
    </div>
  );
}
