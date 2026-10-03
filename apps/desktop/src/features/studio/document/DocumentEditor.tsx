import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Download, FilePlus2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Segmented } from "@/components/tool/form";
import { basenameOf } from "@/shared/lib/paths";
import type { DocumentNode } from "@/types/studio";
import { DocumentExportDialog } from "./DocumentExportDialog";
import { DocumentPreview } from "./DocumentPreview";
import { DocumentSettingsPanel } from "./DocumentSettingsPanel";
import { DocumentToolbar } from "./DocumentToolbar";
import { fontStack, loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { documentExtensions } from "./extensions";
import { pageSize, POINTS_PER_MM } from "./model";
import { useDocumentSave } from "./useDocumentSave";

const SIDE_TABS = ["preview", "settings"] as const;
const PAPER_GUTTER = 64;
const MAX_ZOOM = 1.25;
const PX_PER_PT = 4 / 3;

type SideTab = (typeof SIDE_TABS)[number];

function DocumentTopBar({ onExport }: { onExport: () => void }) {
  const { t } = useTranslation();
  const name = useDocumentStore((state) => state.document?.name ?? "");
  const filePath = useDocumentStore((state) => state.filePath);
  const dirty = useDocumentStore((state) => state.dirty);
  const { saving, save } = useDocumentSave();
  const store = useDocumentStore.getState();
  return (
    <div className="glass flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3" role="toolbar" aria-label={t("studio.doc.label")}>
      <IconButton icon={ArrowLeft} label={t("studio.toolbar.leave")} onClick={store.close} />
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
      <Button variant="primary" icon={<Download className="size-4" aria-hidden />} onClick={onExport} className="ml-auto">
        {t("studio.toolbar.export")}
      </Button>
    </div>
  );
}

function useShortcuts(onExport: () => void) {
  const { save } = useDocumentSave();
  const latest = useRef({ onExport, save });
  latest.current = { onExport, save };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void latest.current.save(event.shiftKey);
      } else if (key === "e" && !event.shiftKey) {
        event.preventDefault();
        latest.current.onExport();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function useFitZoom(width: number) {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setZoom(Math.min(MAX_ZOOM, Math.max(0.3, (node.clientWidth - PAPER_GUTTER) / (width * PX_PER_PT))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return { host, zoom };
}

export default function DocumentEditor({ language }: { language: string }) {
  const { t } = useTranslation();
  const session = useDocumentStore((state) => state.session);
  const settings = useDocumentStore((state) => state.document?.settings);
  const [side, setSide] = useState<SideTab>("preview");
  const [exporting, setExporting] = useState(false);
  const extensions = useMemo(() => documentExtensions(t("studio.doc.placeholder")), [t]);
  useShortcuts(() => setExporting(true));

  const editor = useEditor(
    {
      extensions,
      content: useDocumentStore.getState().document?.content ?? "",
      editorProps: { attributes: { class: "vp-doc-body", "aria-label": t("studio.doc.editorLabel"), spellcheck: "true", lang: language, "data-testid": "document-body" } },
      onCreate: ({ editor: created }) => {
        const content = created.getJSON() as DocumentNode;
        useDocumentStore.setState((state) => (state.document ? { document: { ...state.document, content }, revision: state.revision + 1 } : {}));
      },
      onUpdate: ({ editor: changed }) => useDocumentStore.getState().setContent(changed.getJSON() as DocumentNode),
    },
    [session, extensions],
  );

  useEffect(() => {
    if (!settings) return;
    void loadDocumentFont(settings.fontId);
    if (settings.headingFontId) void loadDocumentFont(settings.headingFontId);
  }, [settings]);

  const size = settings ? pageSize(settings) : { width: 595, height: 842 };
  const { host, zoom } = useFitZoom(size.width);
  if (!settings) return null;
  const margin = settings.marginMm * POINTS_PER_MM;
  const paperStyle: CSSProperties & Record<`--${string}`, string> = {
    width: `${size.width}pt`,
    minHeight: `${size.height}pt`,
    padding: `${margin}pt`,
    zoom,
    fontSize: `${settings.fontSize}pt`,
    lineHeight: String(settings.lineHeight),
    fontFamily: fontStack(settings.fontId),
    "--doc-accent": settings.accent,
    "--doc-heading-font": fontStack(settings.headingFontId ?? settings.fontId),
    "--doc-body-height": `${size.height - margin * 2}pt`,
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="document-editor">
      <DocumentTopBar onExport={() => setExporting(true)} />
      {editor ? <DocumentToolbar editor={editor} contentWidth={size.width - margin * 2} /> : null}
      <div className="flex min-h-0 flex-1">
        <div ref={host} className="min-w-0 flex-1 overflow-auto bg-muted/40 py-8">
          <div className="paper-surface vp-doc mx-auto bg-white shadow-md" style={paperStyle}>
            <EditorContent editor={editor} />
          </div>
        </div>
        <aside className="glass flex w-80 shrink-0 flex-col border-l border-border/60" aria-label={t("studio.doc.side")}>
          <div className="border-b border-border/60 p-3">
            <Segmented size="sm" value={side} options={SIDE_TABS} labelOf={(value) => t(`studio.doc.tabs.${value}`)} onChange={setSide} ariaLabel={t("studio.doc.side")} className="w-full" />
          </div>
          <div className={side === "settings" ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1"}>{side === "preview" ? <DocumentPreview language={language} /> : <DocumentSettingsPanel />}</div>
        </aside>
      </div>
      <DocumentExportDialog open={exporting} onClose={() => setExporting(false)} language={language} />
    </div>
  );
}
