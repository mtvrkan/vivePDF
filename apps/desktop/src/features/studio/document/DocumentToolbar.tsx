import { useEffect, useState, type ReactNode } from "react";
import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Asterisk,
  Baseline,
  Bold,
  BookMarked,
  Code2,
  Columns3,
  Eraser,
  FileText,
  FileX2,
  Hash,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Omega,
  PanelTop,
  PanelsTopLeft,
  Quote,
  RectangleVertical,
  Redo2,
  Replace,
  Rows3,
  Ruler,
  Search,
  SeparatorHorizontal,
  Settings2,
  SquareDashed,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  TableCellsMerge,
  TableCellsSplit,
  TableColumnsSplit,
  TableRowsSplit,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { isMac } from "@/shared/lib/platform";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { CitationLanguage, CitationStyle, DocumentSettings } from "@/types/studio";
import { Ribbon, RibbonButton, RibbonGroup, RibbonRow, RibbonRows, RibbonSmallButton, type RibbonTab } from "../ribbon/Ribbon";
import { useRibbonCollapsed } from "../ribbon/useRibbonCollapsed";
import { AUTO_LANGUAGE, CITATION_LANGUAGES, CITATION_STYLES } from "./citations";
import type { DocumentSettingsSection } from "./settingsSections";
import { pickDocumentImage } from "./documentFile";
import { loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { FormatPainterButton } from "./FormatPainterButton";
import { DOCUMENT_COLUMNS, DOCUMENT_PAPERS, PAGE_NUMBER_PLACES } from "./model";
import { SectionBreakMenu } from "./SectionBreakMenu";
import { SourcesDialog } from "./SourcesDialog";
import { SpacingMenu } from "./SpacingMenu";
import { SymbolDialog } from "./SymbolDialog";
import { PX_TO_PT } from "./toHtml";

const BLOCKS = ["paragraph", "h1", "h2", "h3", "h4"] as const;
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e5e7eb"];
const DEFAULT_TEXT = "#1a1a1a";
const MARGINS = [15, 20, 25, 30];
const RIBBON_TABS = ["home", "insert", "layout", "references"] as const;
const GALLERY = ["paragraph", "h1", "h2", "h3", "h4", "quote"] as const;
const GALLERY_LOOK: Record<(typeof GALLERY)[number], string> = {
  paragraph: "text-xs",
  h1: "text-sm font-bold",
  h2: "text-sm font-semibold",
  h3: "text-xs font-semibold",
  h4: "text-xs font-medium",
  quote: "text-xs italic",
};
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

type Block = (typeof BLOCKS)[number];
type RibbonTabId = (typeof RIBBON_TABS)[number] | "table";

function steppedSize(current: number, direction: 1 | -1): string {
  const sizes = SIZES.map(Number);
  const next = direction > 0 ? sizes.find((size) => size > current) : [...sizes].reverse().find((size) => size < current);
  return String(next ?? current);
}

function blockOf(editor: Editor): Block {
  for (const level of [1, 2, 3, 4] as const) if (editor.isActive("heading", { level })) return `h${level}`;
  return "paragraph";
}

export function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const current = editor.getAttributes("link").href;
  const [href, setHref] = useState(typeof current === "string" ? current : "https://");
  const valid = SAFE_LINK.test(href.trim());
  const apply = () => {
    if (!valid) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("studio.doc.link.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={apply}>
            {t("studio.doc.link.apply")}
          </Button>
        </>
      }
    >
      <Field label={t("studio.doc.link.address")} hint={t("studio.doc.link.hint")}>
        <TextInput
          autoFocus
          value={href}
          maxLength={2000}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
          }}
          aria-invalid={!valid}
        />
      </Field>
    </Dialog>
  );
}

export function DocumentToolbar({
  editor,
  contentWidth,
  onFind = () => undefined,
  onOpenSettings = () => undefined,
}: {
  editor: Editor;
  contentWidth: number;
  onFind?: (replace: boolean) => void;
  onOpenSettings?: (section: DocumentSettingsSection) => void;
}) {
  const { t } = useTranslation();
  const settings = useDocumentStore((state) => state.document?.settings);
  const bodyFont = settings?.fontId ?? "";
  const [tab, setTab] = useState<RibbonTabId>("home");
  const [collapsed, setCollapsed] = useRibbonCollapsed();
  const [linking, setLinking] = useState(false);
  const [citing, setCiting] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const sourcesRequested = useDocumentStore((state) => state.sourcesRequested);
  const showSources = citing || sourcesRequested;
  const closeSources = () => {
    setCiting(false);
    useDocumentStore.getState().requestSources(false);
  };
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const style = current.getAttributes("textStyle");
      return {
        block: blockOf(current),
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        strike: current.isActive("strike"),
        superscript: current.isActive("superscript"),
        subscript: current.isActive("subscript"),
        link: current.isActive("link"),
        bullet: current.isActive("bulletList"),
        ordered: current.isActive("orderedList"),
        task: current.isActive("taskList"),
        quote: current.isActive("blockquote"),
        code: current.isActive("codeBlock"),
        table: current.isActive("table"),
        citation: current.isActive("citation"),
        mergeCells: current.isActive("table") && current.can().mergeCells(),
        splitCell: current.isActive("table") && current.can().splitCell(),
        align: (["left", "center", "right", "justify"] as const).find((value) => current.isActive({ textAlign: value })) ?? "left",
        fontId: typeof style.fontId === "string" ? style.fontId : "",
        fontSize: typeof style.fontSize === "string" ? style.fontSize.replace(/pt$/, "") : "",
        color: typeof style.color === "string" ? style.color : DEFAULT_TEXT,
        highlight: typeof current.getAttributes("highlight").color === "string" ? (current.getAttributes("highlight").color as string) : HIGHLIGHTS[0],
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        canSink: current.can().sinkListItem("listItem") || current.can().sinkListItem("taskItem"),
        canLift: current.can().liftListItem("listItem") || current.can().liftListItem("taskItem"),
      };
    },
  });
  const chain = () => editor.chain().focus();

  useEffect(() => {
    if (!state.table) setTab((current) => (current === "table" ? "home" : current));
  }, [state.table]);

  const setBlock = (block: string) => {
    if (block === "paragraph") chain().setParagraph().run();
    else chain().setHeading({ level: Number(block.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const setFont = (fontId: string) => {
    void loadDocumentFont(fontId);
    if (fontId === bodyFont) chain().unsetFontId().run();
    else chain().setFontId(fontId).run();
  };

  const setSize = (size: string) => {
    if (!size) chain().unsetFontSize().run();
    else chain().setFontSize(`${size}pt`).run();
  };

  const bodySize = settings?.fontSize ?? 11;
  const shownSize = state.fontSize ? Number(state.fontSize) : bodySize;

  const insertImage = async () => {
    try {
      const picked = await pickDocumentImage(t("studio.doc.toolbar.image"));
      if (!picked) return;
      const width = Math.round(Math.min(picked.width, contentWidth / PX_TO_PT));
      chain().setImage({ src: picked.src, alt: "", width }).run();
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    }
  };

  const listSink = () => (editor.isActive("taskList") ? chain().sinkListItem("taskItem").run() : chain().sinkListItem("listItem").run());
  const listLift = () => (editor.isActive("taskList") ? chain().liftListItem("taskItem").run() : chain().liftListItem("listItem").run());

  const update = (patch: Partial<DocumentSettings>) => useDocumentStore.getState().setSettings(patch);
  const toggleCover = () => {
    if (settings?.cover) {
      update({ cover: false });
      return;
    }
    update({ cover: true });
    onOpenSettings("cover");
  };

  const choice = <T,>(values: readonly T[], current: T | undefined, labelOf: (value: T) => string, apply: (value: T) => void, idOf: (value: T) => string): ContextMenuItem[] =>
    values.map((value) => ({ type: "item", id: idOf(value), label: labelOf(value), checked: value === current, onSelect: () => apply(value) }));

  const marginItems: ContextMenuItem[] = [
    ...choice(MARGINS, settings?.marginMm, (value) => t("studio.doc.ribbon.marginValue", { value }), (marginMm) => update({ marginMm }), (value) => `margin-${value}`),
    { type: "separator", id: "margin-more" },
    { type: "item", id: "margin-custom", label: t("studio.doc.ribbon.marginCustom"), onSelect: () => onOpenSettings("page") },
  ];
  const orientationItems = choice(["portrait", "landscape"] as const, settings?.landscape ? "landscape" : "portrait", (value) => t(`studio.doc.settings.${value}`), (value) => update({ landscape: value === "landscape" }), (value) => `orientation-${value}`);
  const paperItems = choice(DOCUMENT_PAPERS, settings?.paper, (value) => t(`studio.doc.papers.${value}`), (paper) => update({ paper }), (value) => `paper-${value}`);
  const columnItems = choice(DOCUMENT_COLUMNS, settings?.columns, (value) => t(`studio.doc.ribbon.columns${value}`), (columns) => update({ columns }), (value) => `columns-${value}`);
  const numberItems = choice(PAGE_NUMBER_PLACES, settings?.pageNumbers, (value) => t(`studio.doc.numbers.${value}`), (pageNumbers) => update({ pageNumbers }), (value) => `numbers-${value}`);

  const tabs: RibbonTab[] = [
    ...RIBBON_TABS.map((id) => ({ id, label: t(`studio.doc.ribbon.tabs.${id}`) })),
    ...(state.table ? [{ id: "table", label: t("studio.doc.ribbon.tabs.table"), contextual: true }] : []),
  ];
  const active: RibbonTabId = tab === "table" && !state.table ? "home" : tab;
  const galleryActive = state.quote ? "quote" : state.block;

  const home = (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.history")}>
        <RibbonRows>
          <RibbonRow>
            <IconButton icon={Undo2} label={t("studio.toolbar.undo")} shortcut="Ctrl+Z" disabled={!state.canUndo} onClick={() => chain().undo().run()} />
            <IconButton icon={Redo2} label={t("studio.toolbar.redo")} shortcut="Ctrl+Y" disabled={!state.canRedo} onClick={() => chain().redo().run()} />
          </RibbonRow>
          <RibbonRow>
            <FormatPainterButton editor={editor} />
            <IconButton icon={Eraser} label={t("studio.doc.toolbar.clear")} onClick={() => chain().unsetAllMarks().run()} />
          </RibbonRow>
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.font")}>
        <RibbonRows>
          <RibbonRow>
            <div className="w-36">
              <FontPicker compact value={state.fontId || bodyFont} onChange={setFont} />
            </div>
            <Select
              size="sm"
              className="ml-1 h-8 w-24"
              value={state.fontSize}
              options={[{ value: "", label: t("studio.doc.ribbon.sizeDocument", { size: bodySize }) }, ...SIZES.map((size) => ({ value: size, label: `${size} pt` }))]}
              onChange={setSize}
              ariaLabel={t("studio.doc.toolbar.size")}
            />
            <IconButton icon={AArrowUp} label={t("studio.doc.ribbon.sizeUp")} onClick={() => setSize(steppedSize(shownSize, 1))} />
            <IconButton icon={AArrowDown} label={t("studio.doc.ribbon.sizeDown")} onClick={() => setSize(steppedSize(shownSize, -1))} />
          </RibbonRow>
          <RibbonRow>
            <IconButton icon={Bold} label={t("studio.doc.toolbar.bold")} shortcut="Ctrl+B" active={state.bold} onClick={() => chain().toggleBold().run()} />
            <IconButton icon={Italic} label={t("studio.doc.toolbar.italic")} shortcut="Ctrl+I" active={state.italic} onClick={() => chain().toggleItalic().run()} />
            <IconButton icon={Underline} label={t("studio.doc.toolbar.underline")} shortcut="Ctrl+U" active={state.underline} onClick={() => chain().toggleUnderline().run()} />
            <IconButton icon={Strikethrough} label={t("studio.doc.toolbar.strike")} active={state.strike} onClick={() => chain().toggleStrike().run()} />
            <IconButton icon={Superscript} label={t("studio.doc.toolbar.superscript")} active={state.superscript} onClick={() => chain().toggleSuperscript().run()} />
            <IconButton icon={Subscript} label={t("studio.doc.toolbar.subscript")} active={state.subscript} onClick={() => chain().toggleSubscript().run()} />
            <ColorSwatch
              icon={Baseline}
              value={state.color}
              onChange={(color) => chain().setColor(color).run()}
              onClear={() => chain().unsetColor().run()}
              clearLabel={t("studio.doc.ribbon.colorAuto")}
              label={t("studio.doc.toolbar.color")}
              customLabel={t("colorPicker.custom")}
            />
            <ColorSwatch
              icon={Highlighter}
              value={state.highlight}
              presets={HIGHLIGHTS}
              onChange={(color) => chain().setHighlight({ color }).run()}
              onClear={() => chain().unsetHighlight().run()}
              clearLabel={t("studio.doc.ribbon.highlightNone")}
              label={t("studio.doc.toolbar.highlightColor")}
              customLabel={t("colorPicker.custom")}
            />
          </RibbonRow>
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.paragraph")}>
        <RibbonRows>
          <RibbonRow>
            <IconButton icon={List} label={t("studio.doc.toolbar.bulletList")} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
            <IconButton icon={ListOrdered} label={t("studio.doc.toolbar.orderedList")} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
            <IconButton icon={ListChecks} label={t("studio.doc.toolbar.taskList")} active={state.task} onClick={() => chain().toggleTaskList().run()} />
            <IconButton icon={IndentDecrease} label={t("studio.doc.toolbar.outdent")} shortcut="Shift+Tab" disabled={!state.canLift} onClick={listLift} />
            <IconButton icon={IndentIncrease} label={t("studio.doc.toolbar.indent")} shortcut="Tab" disabled={!state.canSink} onClick={listSink} />
          </RibbonRow>
          <RibbonRow>
            <IconButton icon={AlignLeft} label={t("studio.textAlign.left")} active={state.align === "left"} onClick={() => chain().setTextAlign("left").run()} />
            <IconButton icon={AlignCenter} label={t("studio.textAlign.center")} active={state.align === "center"} onClick={() => chain().setTextAlign("center").run()} />
            <IconButton icon={AlignRight} label={t("studio.textAlign.right")} active={state.align === "right"} onClick={() => chain().setTextAlign("right").run()} />
            <IconButton icon={AlignJustify} label={t("studio.textAlign.justify")} active={state.align === "justify"} onClick={() => chain().setTextAlign("justify").run()} />
            <SpacingMenu editor={editor} />
          </RibbonRow>
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.styles")}>
        <div className="hidden grid-cols-3 gap-1 @5xl:grid" data-testid="doc-style-gallery">
          {GALLERY.map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={galleryActive === style}
              onClick={() => (style === "quote" ? chain().toggleBlockquote().run() : setBlock(style))}
              className={cn("nav-glass flex h-8 w-24 items-center truncate rounded-lg px-2 text-foreground/85 hover:text-foreground", GALLERY_LOOK[style], galleryActive === style && "glass-chip text-primary")}
            >
              {style === "quote" ? t("studio.doc.toolbar.quote") : t(`studio.doc.blocks.${style}`)}
            </button>
          ))}
        </div>
        <Select
          size="sm"
          className="h-8 w-36 @5xl:hidden"
          value={state.block}
          options={BLOCKS.map((block) => ({ value: block, label: t(`studio.doc.blocks.${block}`) }))}
          onChange={setBlock}
          ariaLabel={t("studio.doc.toolbar.block")}
        />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.editing")} className="hidden @3xl:flex">
        <RibbonRows>
          <RibbonSmallButton icon={Search} label={t("studio.doc.ribbon.find")} shortcut="Ctrl+F" onClick={() => onFind(false)} testId="doc-ribbon-find" />
          <RibbonSmallButton icon={Replace} label={t("studio.doc.ribbon.replace")} shortcut={isMac ? "Ctrl+Alt+F" : "Ctrl+H"} onClick={() => onFind(true)} testId="doc-ribbon-replace" />
        </RibbonRows>
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.tables")}>
        <RibbonButton icon={Table2} label={t("studio.doc.ribbon.table")} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} testId="doc-insert-table" />
        <RibbonButton icon={ImageIcon} label={t("studio.doc.ribbon.image")} onClick={() => void insertImage()} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.links")}>
        <RibbonButton icon={Link2} label={t("studio.doc.ribbon.link")} active={state.link} onClick={() => setLinking(true)} />
        {state.link ? <RibbonButton icon={Unlink} label={t("studio.doc.ribbon.unlink")} onClick={() => chain().extendMarkRange("link").unsetLink().run()} /> : null}
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.text")}>
        <RibbonButton icon={Omega} label={t("studio.doc.ribbon.symbol")} onClick={() => setSymbols(true)} testId="doc-symbols" />
        <RibbonButton icon={Minus} label={t("studio.doc.ribbon.rule")} onClick={() => chain().setHorizontalRule().run()} />
        <RibbonButton icon={Quote} label={t("studio.doc.toolbar.quote")} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
        <RibbonButton icon={Code2} label={t("studio.doc.ribbon.code")} active={state.code} onClick={() => chain().toggleCodeBlock().run()} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.pages")}>
        <RibbonButton icon={FileText} label={t("studio.doc.ribbon.cover")} active={settings?.cover ?? false} onClick={toggleCover} />
        <RibbonButton icon={SeparatorHorizontal} label={t("studio.doc.toolbar.pageBreak")} shortcut="Ctrl+Enter" onClick={() => chain().setPageBreak().run()} />
      </RibbonGroup>
    </>
  );

  const layout = (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.pageSetup")}>
        <RibbonButton icon={SquareDashed} label={t("studio.doc.ribbon.margins")} menu={marginItems} testId="doc-margins" />
        <RibbonButton icon={RectangleVertical} label={t("studio.doc.ribbon.orientation")} menu={orientationItems} />
        <RibbonButton icon={Ruler} label={t("studio.doc.ribbon.paper")} menu={paperItems} />
        <RibbonButton icon={Columns3} label={t("studio.doc.ribbon.columns")} menu={columnItems} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.breaks")}>
        <SectionBreakMenu editor={editor} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.furniture")}>
        <RibbonButton icon={PanelsTopLeft} label={t("studio.doc.ribbon.headerFooter")} onClick={() => onOpenSettings("furniture")} />
        <RibbonButton icon={Hash} label={t("studio.doc.ribbon.pageNumbers")} menu={numberItems} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.more")}>
        <RibbonButton icon={Settings2} label={t("studio.doc.ribbon.pageSettings")} onClick={() => onOpenSettings("page")} />
      </RibbonGroup>
    </>
  );

  const references = (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.citations")}>
        <RibbonButton icon={BookMarked} label={t("studio.doc.cite.title")} active={state.citation} onClick={() => setCiting(true)} testId="doc-citations" />
        <RibbonButton icon={ListOrdered} label={t("studio.doc.cite.insertList")} onClick={() => chain().insertBibliography().run()} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.citationStyle")}>
        <RibbonRows>
          <Select
            size="sm"
            className="h-8 w-52"
            value={settings?.citationStyle ?? "apa"}
            options={CITATION_STYLES.map((value) => ({ value, label: t(`studio.doc.cite.styles.${value}`) }))}
            onChange={(value) => update({ citationStyle: value as CitationStyle })}
            ariaLabel={t("studio.doc.cite.style")}
          />
          <Select
            size="sm"
            className="h-8 w-52"
            value={settings?.citationLanguage ?? AUTO_LANGUAGE}
            options={[{ value: AUTO_LANGUAGE, label: t("studio.doc.cite.languages.auto") }, ...CITATION_LANGUAGES.map((value) => ({ value, label: t(`studio.doc.cite.languages.${value}`) }))]}
            onChange={(value) => update({ citationLanguage: value === AUTO_LANGUAGE ? null : (value as CitationLanguage) })}
            ariaLabel={t("studio.doc.cite.language")}
          />
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.footnotes")}>
        <RibbonButton icon={Asterisk} label={t("studio.doc.footnotes.insert")} shortcut="Ctrl+Alt+F" onClick={() => chain().insertFootnote().run()} testId="doc-footnote" />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.contents")}>
        <RibbonButton icon={ListTree} label={t("studio.doc.ribbon.toc")} active={settings?.toc ?? false} onClick={() => update({ toc: !settings?.toc })} testId="doc-toc" />
      </RibbonGroup>
    </>
  );

  const table = (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.tableInsert")}>
        <RibbonButton icon={Rows3} label={t("studio.doc.ribbon.addRow")} onClick={() => chain().addRowAfter().run()} />
        <RibbonButton icon={Columns3} label={t("studio.doc.ribbon.addColumn")} onClick={() => chain().addColumnAfter().run()} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.tableDelete")}>
        <RibbonButton icon={TableRowsSplit} label={t("studio.doc.table.deleteRow")} onClick={() => chain().deleteRow().run()} />
        <RibbonButton icon={TableColumnsSplit} label={t("studio.doc.table.deleteColumn")} onClick={() => chain().deleteColumn().run()} />
        <RibbonButton icon={FileX2} label={t("studio.doc.table.delete")} onClick={() => chain().deleteTable().run()} />
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.cells")}>
        <RibbonButton icon={TableCellsMerge} label={t("studio.doc.ribbon.merge")} disabled={!state.mergeCells} onClick={() => chain().mergeCells().run()} testId="doc-merge-cells" />
        <RibbonButton icon={TableCellsSplit} label={t("studio.doc.ribbon.split")} disabled={!state.splitCell} onClick={() => chain().splitCell().run()} testId="doc-split-cell" />
        <RibbonButton icon={PanelTop} label={t("studio.doc.ribbon.headerRow")} onClick={() => chain().toggleHeaderRow().run()} />
      </RibbonGroup>
    </>
  );

  const panels: Record<RibbonTabId, ReactNode> = { home, insert, layout, references, table };

  return (
    <>
      <Ribbon
        label={t("studio.doc.toolbar.label")}
        tabs={tabs}
        active={active}
        onSelect={(id) => setTab(id as RibbonTabId)}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        collapseLabel={t("studio.doc.ribbon.collapse")}
        expandLabel={t("studio.doc.ribbon.expand")}
      >
        {panels[active]}
      </Ribbon>
      {linking ? <LinkDialog editor={editor} open={linking} onClose={() => setLinking(false)} /> : null}
      {symbols ? <SymbolDialog editor={editor} onClose={() => setSymbols(false)} /> : null}
      {showSources ? <SourcesDialog editor={editor} open={showSources} onClose={closeSources} /> : null}
    </>
  );
}
