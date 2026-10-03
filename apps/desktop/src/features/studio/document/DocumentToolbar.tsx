import { useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Columns3,
  Eraser,
  FileX2,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PanelTop,
  Quote,
  Redo2,
  Rows3,
  SeparatorHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
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
import { Dialog } from "@/components/shared/Dialog";
import { FontPicker } from "@/components/shared/FontPicker";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { pickDocumentImage } from "./documentFile";
import { loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { PX_TO_PT } from "./toHtml";

const BLOCKS = ["paragraph", "h1", "h2", "h3", "h4"] as const;
const SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e5e7eb"];
const DEFAULT_TEXT = "#1a1a1a";
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

type Block = (typeof BLOCKS)[number];

function Divider() {
  return <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />;
}

function blockOf(editor: Editor): Block {
  for (const level of [1, 2, 3, 4] as const) if (editor.isActive("heading", { level })) return `h${level}`;
  return "paragraph";
}

function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
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

export function DocumentToolbar({ editor, contentWidth }: { editor: Editor; contentWidth: number }) {
  const { t } = useTranslation();
  const bodyFont = useDocumentStore((state) => state.document?.settings.fontId ?? "");
  const [linking, setLinking] = useState(false);
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

  return (
    <div className="glass flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-3 py-1.5" role="toolbar" aria-label={t("studio.doc.toolbar.label")}>
      <IconButton icon={Undo2} label={t("studio.toolbar.undo")} shortcut="Ctrl+Z" disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <IconButton icon={Redo2} label={t("studio.toolbar.redo")} shortcut="Ctrl+Y" disabled={!state.canRedo} onClick={() => chain().redo().run()} />
      <Divider />
      <Select size="sm" className="w-36" value={state.block} options={BLOCKS.map((block) => ({ value: block, label: t(`studio.doc.blocks.${block}`) }))} onChange={setBlock} ariaLabel={t("studio.doc.toolbar.block")} />
      <div className="w-44">
        <FontPicker value={state.fontId || bodyFont} onChange={setFont} />
      </div>
      <Select
        size="sm"
        className="w-24"
        value={state.fontSize}
        options={[{ value: "", label: t("studio.doc.toolbar.sizeDefault") }, ...SIZES.map((size) => ({ value: size, label: `${size} pt` }))]}
        onChange={setSize}
        ariaLabel={t("studio.doc.toolbar.size")}
      />
      <Divider />
      <IconButton icon={Bold} label={t("studio.doc.toolbar.bold")} shortcut="Ctrl+B" active={state.bold} onClick={() => chain().toggleBold().run()} />
      <IconButton icon={Italic} label={t("studio.doc.toolbar.italic")} shortcut="Ctrl+I" active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <IconButton icon={Underline} label={t("studio.doc.toolbar.underline")} shortcut="Ctrl+U" active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <IconButton icon={Strikethrough} label={t("studio.doc.toolbar.strike")} active={state.strike} onClick={() => chain().toggleStrike().run()} />
      <IconButton icon={Superscript} label={t("studio.doc.toolbar.superscript")} active={state.superscript} onClick={() => chain().toggleSuperscript().run()} />
      <IconButton icon={Subscript} label={t("studio.doc.toolbar.subscript")} active={state.subscript} onClick={() => chain().toggleSubscript().run()} />
      <ColorSwatch value={state.color} onChange={(color) => chain().setColor(color).run()} label={t("studio.doc.toolbar.color")} customLabel={t("colorPicker.custom")} />
      <span className="inline-flex items-center gap-0.5">
        <IconButton icon={Highlighter} label={t("studio.doc.toolbar.highlight")} onClick={() => chain().toggleHighlight({ color: state.highlight }).run()} />
        <ColorSwatch value={state.highlight} presets={HIGHLIGHTS} onChange={(color) => chain().setHighlight({ color }).run()} label={t("studio.doc.toolbar.highlightColor")} customLabel={t("colorPicker.custom")} />
      </span>
      <IconButton icon={Eraser} label={t("studio.doc.toolbar.clear")} onClick={() => chain().unsetAllMarks().run()} />
      <Divider />
      <IconButton icon={AlignLeft} label={t("studio.textAlign.left")} active={state.align === "left"} onClick={() => chain().setTextAlign("left").run()} />
      <IconButton icon={AlignCenter} label={t("studio.textAlign.center")} active={state.align === "center"} onClick={() => chain().setTextAlign("center").run()} />
      <IconButton icon={AlignRight} label={t("studio.textAlign.right")} active={state.align === "right"} onClick={() => chain().setTextAlign("right").run()} />
      <IconButton icon={AlignJustify} label={t("studio.textAlign.justify")} active={state.align === "justify"} onClick={() => chain().setTextAlign("justify").run()} />
      <Divider />
      <IconButton icon={List} label={t("studio.doc.toolbar.bulletList")} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
      <IconButton icon={ListOrdered} label={t("studio.doc.toolbar.orderedList")} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <IconButton icon={ListChecks} label={t("studio.doc.toolbar.taskList")} active={state.task} onClick={() => chain().toggleTaskList().run()} />
      <IconButton icon={IndentDecrease} label={t("studio.doc.toolbar.outdent")} shortcut="Shift+Tab" disabled={!state.canLift} onClick={listLift} />
      <IconButton icon={IndentIncrease} label={t("studio.doc.toolbar.indent")} shortcut="Tab" disabled={!state.canSink} onClick={listSink} />
      <IconButton icon={Quote} label={t("studio.doc.toolbar.quote")} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <IconButton icon={Code2} label={t("studio.doc.toolbar.codeBlock")} active={state.code} onClick={() => chain().toggleCodeBlock().run()} />
      <Divider />
      <IconButton icon={Link2} label={t("studio.doc.toolbar.link")} active={state.link} onClick={() => setLinking(true)} />
      {state.link ? <IconButton icon={Unlink} label={t("studio.doc.toolbar.unlink")} onClick={() => chain().extendMarkRange("link").unsetLink().run()} /> : null}
      <IconButton icon={ImageIcon} label={t("studio.doc.toolbar.image")} onClick={() => void insertImage()} />
      <IconButton icon={Table2} label={t("studio.doc.toolbar.table")} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <IconButton icon={Minus} label={t("studio.doc.toolbar.rule")} onClick={() => chain().setHorizontalRule().run()} />
      <IconButton icon={SeparatorHorizontal} label={t("studio.doc.toolbar.pageBreak")} shortcut="Ctrl+Enter" onClick={() => chain().setPageBreak().run()} />
      {state.table ? (
        <span className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-1" role="group" aria-label={t("studio.doc.table.label")}>
          <IconButton icon={Rows3} label={t("studio.doc.table.addRow")} onClick={() => chain().addRowAfter().run()} />
          <IconButton icon={Columns3} label={t("studio.doc.table.addColumn")} onClick={() => chain().addColumnAfter().run()} />
          <IconButton icon={TableRowsSplit} label={t("studio.doc.table.deleteRow")} onClick={() => chain().deleteRow().run()} />
          <IconButton icon={TableColumnsSplit} label={t("studio.doc.table.deleteColumn")} onClick={() => chain().deleteColumn().run()} />
          <IconButton icon={PanelTop} label={t("studio.doc.table.headerRow")} onClick={() => chain().toggleHeaderRow().run()} />
          <IconButton icon={FileX2} label={t("studio.doc.table.delete")} onClick={() => chain().deleteTable().run()} />
        </span>
      ) : null}
      {linking ? <LinkDialog editor={editor} open={linking} onClose={() => setLinking(false)} /> : null}
    </div>
  );
}
