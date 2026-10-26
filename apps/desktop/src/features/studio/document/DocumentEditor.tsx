import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Download, FilePlus2, Printer, Save, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { basenameOf } from "@/shared/lib/paths";
import { shortcutLetter } from "@/shared/lib/shortcutKeys";
import type { DocumentNode } from "@/types/studio";
import { DocumentExportDialog } from "./DocumentExportDialog";
import { DocumentFindBar, type DocumentFindMode } from "./DocumentFindBar";
import { FootnotePanel } from "./FootnotePanel";
import { HorizontalRuler, VerticalRuler } from "./DocumentRuler";
import { DocumentStatusBar } from "./DocumentStatusBar";
import { useDocumentViewStore, type DocumentZoom } from "./documentView";
import type { PageLine } from "./pageBreaks";
import { PageLines } from "./PageLines";
import { NavigationPane } from "./NavigationPane";
import { PageSetupDialog } from "./PageSetupDialog";
import { firstPage } from "./pageBreaks";
import { SheetFurniture } from "./SheetFurniture";
import { headingNumbersKey, setHeadingNumbers } from "./headingNumbers";
import { useFurnitureEditing } from "./furnitureEditing";
import { PrintPreview } from "./PrintPreview";
import { useDocumentLayout } from "./useDocumentLayout";
import { DocumentToolbar } from "./DocumentToolbar";
import { fontStack, loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { contentInsets, pageSize } from "./model";
import { useDocumentSave } from "./useDocumentSave";

import { commandKey } from "@/shared/lib/platform";
import { findShortcut } from "@/features/studio/findShortcut";
const PAPER_GUTTER = 64;
const MAX_FIT = 1.25;
const MIN_ZOOM = 0.3;
const PX_PER_PT = 4 / 3;

function DocumentTopBar({ onExport, onFind, onPrintPreview }: { onExport: () => void; onFind: () => void; onPrintPreview: () => void }) {
  const { t } = useTranslation();
  const name = useDocumentStore((state) => state.document?.name ?? "");
  const filePath = useDocumentStore((state) => state.filePath ?? state.sourceFile?.path ?? null);
  const dirty = useDocumentStore((state) => state.dirty);
  const { saving, save } = useDocumentSave();
  const [leaving, setLeaving] = useState(false);
  const store = useDocumentStore.getState();
  const leave = () => {
    const state = useDocumentStore.getState();
    if (state.sourceFile && state.dirty) setLeaving(true);
    else state.close();
  };
  const closeAfter = (saved: boolean) => {
    if (!saved) return;
    setLeaving(false);
    useDocumentStore.getState().close();
  };
  return (
    <div className="glass flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3" role="toolbar" aria-label={t("studio.doc.label")}>
      <IconButton icon={ArrowLeft} label={t("studio.toolbar.leave")} onClick={leave} />
      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t("studio.doc.cite.leaveTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => closeAfter(true)}
            >
              {t("studio.project.discard")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save(false).then(closeAfter)}>
              {t("studio.project.save")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("studio.doc.cite.leaveBody", { name: filePath ? basenameOf(filePath) : name })}</p>
      </Dialog>
      <input
        value={name}
        maxLength={200}
        placeholder={t("studio.doc.untitled")}
        aria-label={t("studio.doc.name")}
        onChange={(event) => store.setName(event.target.value)}
        className="field h-8 w-56 min-w-0 rounded-lg px-2 text-sm font-medium"
      />
      <span className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline" title={filePath ?? undefined} data-testid="document-save-state">
        {filePath ? (dirty ? t("studio.project.edited", { name: basenameOf(filePath) }) : basenameOf(filePath)) : t("studio.project.notSaved")}
      </span>
      <IconButton icon={Save} label={t("studio.project.save")} shortcut="Ctrl+S" disabled={saving} onClick={() => void save(false)} />
      <IconButton icon={FilePlus2} label={t("studio.project.saveAs")} shortcut="Ctrl+Shift+S" disabled={saving} onClick={() => void save(true)} />
      <IconButton icon={Search} label={t("studio.find.title")} shortcut="Ctrl+F" onClick={onFind} data-testid="document-find-open" />
      <Button variant="ghost" icon={<Printer className="size-4" aria-hidden />} onClick={onPrintPreview} className="ml-auto" data-testid="document-print-preview-open">
        {t("studio.doc.printPreview.title")}
      </Button>
      <Button variant="primary" icon={<Download className="size-4" aria-hidden />} onClick={onExport}>
        {t("studio.toolbar.export")}
      </Button>
    </div>
  );
}

function useShortcuts(onExport: () => void, onFind: (replace: boolean) => void) {
  const { save } = useDocumentSave();
  const latest = useRef({ onExport, onFind, save });
  latest.current = { onExport, onFind, save };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const letter = shortcutLetter(event);
      const search = findShortcut(event, letter);
      if (search) {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onFind(search === "replace");
        return;
      }
      if (!commandKey(event) || event.altKey) return;
      if (letter === "s") {
        event.preventDefault();
        event.stopPropagation();
        void latest.current.save(event.shiftKey);
      } else if (letter === "e" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onExport();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

function usePaperZoom(size: { width: number; height: number }, mode: DocumentZoom) {
  const host = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ width: 1, page: 1 });
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () =>
      setFit({
        width: Math.min(MAX_FIT, Math.max(MIN_ZOOM, (node.clientWidth - PAPER_GUTTER) / (size.width * PX_PER_PT))),
        page: Math.min(MAX_FIT, Math.max(MIN_ZOOM, (node.clientHeight - PAPER_GUTTER) / (size.height * PX_PER_PT))),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [size.width, size.height]);
  const zoom = mode === "width" ? fit.width : mode === "page" ? Math.min(fit.page, fit.width) : mode / 100;
  return { host, zoom };
}

export default function DocumentEditor({ language }: { language: string }) {
  const { t } = useTranslation();
  const session = useDocumentStore((state) => state.session);
  const settings = useDocumentStore((state) => state.document?.settings);
  const zoomMode = useDocumentViewStore((state) => state.zoom);
  const showPageLines = useDocumentViewStore((state) => state.pageLines);
  const showRuler = useDocumentViewStore((state) => state.ruler);
  const showNavigation = useDocumentViewStore((state) => state.navigation);
  const paper = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<PageLine[]>([]);
  const layout = useDocumentLayout(language);
  const [previewing, setPreviewing] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [finding, setFinding] = useState<DocumentFindMode | null>(null);
  const openFind = (replace: boolean) => setFinding((current) => ({ replace, nonce: (current?.nonce ?? 0) + 1 }));
  const furnitureEditing = useFurnitureEditing((state) => state.editing !== null);
  const extensions = useMemo(() => documentExtensions(t("studio.doc.placeholder"), storeCitationSource(language, t("studio.doc.cite.referencesDefault"), t("studio.doc.cite.emptyList")), (columns, continuous) => t(continuous ? "studio.doc.section.labelContinuous" : "studio.doc.section.label", { columns }), t("studio.doc.mainMatter.label")), [t, language]);
  useShortcuts(() => setExporting(true), openFind);

  const editor = useEditor(
    {
      extensions,
      content: useDocumentStore.getState().currentContent(),
      editorProps: { attributes: { class: "vp-doc-body", "aria-label": t("studio.doc.editorLabel"), spellcheck: "true", lang: language, "data-testid": "document-body" } },
      onCreate: ({ editor: created }) => {
        const content = created.getJSON() as DocumentNode;
        useDocumentStore.setState((state) => (state.document ? { document: { ...state.document, content }, revision: state.revision + 1 } : {}));
      },
      onUpdate: ({ editor: changed }) => useDocumentStore.getState().deferContent(() => changed.getJSON() as DocumentNode),
    },
    [session, extensions],
  );

  useEffect(() => {
    if (!editor) return;
    const stop = () => useFurnitureEditing.getState().stop();
    editor.on("focus", stop);
    return () => {
      editor.off("focus", stop);
      stop();
    };
  }, [editor]);

  const headingNumbers = settings?.headingNumbers ?? "none";
  useEffect(() => {
    if (!editor || editor.isDestroyed || headingNumbersKey.getState(editor.state)?.style === headingNumbers) return;
    editor.view.dispatch(setHeadingNumbers(editor.state, headingNumbers));
  }, [editor, headingNumbers]);

  useEffect(() => {
    if (!settings) return;
    void loadDocumentFont(settings.fontId);
    if (settings.headingFontId) void loadDocumentFont(settings.headingFontId);
  }, [settings]);

  const size = settings ? pageSize(settings) : { width: 595, height: 842 };
  const { host, zoom } = usePaperZoom(size, zoomMode);
  if (!settings) return null;
  const inset = contentInsets(settings);
  const sheetPage = (layout.preview && firstPage(layout.preview)) || 1;
  const pageLabels = layout.preview?.pageLabels;
  const paperStyle: CSSProperties & Record<`--${string}`, string> = {
    width: `${size.width}pt`,
    minHeight: `${size.height}pt`,
    padding: `${inset.top}pt ${inset.right}pt ${inset.bottom}pt ${inset.left}pt`,
    zoom,
    fontSize: `${settings.fontSize}pt`,
    lineHeight: String(settings.lineHeight),
    fontFamily: fontStack(settings.fontId),
    "--doc-accent": settings.accent,
    "--doc-heading-font": fontStack(settings.headingFontId ?? settings.fontId),
    "--doc-body-height": `${size.height - inset.top - inset.bottom}pt`,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="document-editor">
      <DocumentTopBar onExport={() => setExporting(true)} onFind={() => openFind(false)} onPrintPreview={() => setPreviewing(true)} />
      {editor ? <DocumentToolbar editor={editor} contentWidth={size.width - inset.left - inset.right} onFind={openFind} onPrintPreview={() => setPreviewing(true)} onPageSetup={() => setPageSetupOpen(true)} /> : null}
      <div className="flex min-h-0 flex-1">
        {editor && showNavigation ? <NavigationPane editor={editor} /> : null}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40 py-8">
              <div ref={paper} className="paper-surface vp-doc relative mx-auto bg-white shadow-md" style={paperStyle}>
                <EditorContent editor={editor} className={furnitureEditing ? "opacity-50 transition-opacity duration-(--transition-base)" : "transition-opacity duration-(--transition-base)"} />
                {editor ? <SheetFurniture settings={settings} inset={inset} page={sheetPage} label={pageLabels?.[sheetPage - 1] ?? String(sheetPage)} last={pageLabels?.at(-1) ?? String(layout.preview?.pageCount ?? 1)} onLeave={() => editor.commands.focus()} /> : null}
                {editor && showPageLines ? <PageLines editor={editor} laid={layout.preview} paper={paper} zoom={zoom} onLines={setLines} /> : null}
              </div>
            </div>
            {editor && showRuler ? <VerticalRuler editor={editor} settings={settings} size={size} paper={paper} host={host} laid={layout.preview} lines={showPageLines ? lines : null} zoom={zoom} /> : null}
          </div>
          {editor && showRuler ? <HorizontalRuler editor={editor} settings={settings} size={size} paper={paper} host={host} /> : null}
          {editor ? <FootnotePanel editor={editor} /> : null}
          {finding && editor ? <DocumentFindBar editor={editor} mode={finding} language={language} onClose={() => setFinding(null)} /> : null}
          {editor ? <DocumentStatusBar editor={editor} language={language} layout={layout} zoom={zoom} lines={showPageLines ? lines : null} paper={paper} /> : null}
        </div>
      </div>
      <PageSetupDialog open={pageSetupOpen} onClose={() => setPageSetupOpen(false)} />
      <PrintPreview open={previewing} layout={layout} onClose={() => setPreviewing(false)} onExport={() => setExporting(true)} />
      <DocumentExportDialog open={exporting} onClose={() => setExporting(false)} language={language} />
    </div>
  );
}
