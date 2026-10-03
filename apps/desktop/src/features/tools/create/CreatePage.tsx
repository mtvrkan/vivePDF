import { useEffect, useState, type ReactNode } from "react";
import { FilePlus2, FileText, ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { Checkbox, Field, OptionCards, Section, Segmented, SliderField, TextArea, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { sanitizeFileName } from "@/shared/lib/naming";
import { basenameOf, defaultOutputDirectory, joinPath, siblingPath } from "@/shared/lib/paths";
import { createDocument } from "@/shared/rpc/operations";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CreateFont, CreateTemplate } from "@/types";
import { BulkCreator } from "./BulkCreator";
import { PaperCreator } from "./PaperCreator";
import {
  CREATE_FONTS,
  CREATE_PAPERS,
  CREATE_TABS,
  CREATE_TEMPLATES,
  DEFAULT_ACCENT,
  LOGO_EXTENSIONS,
  TEXT_SOURCE_EXTENSIONS,
  authorLabelKey,
  longDate,
  templateDefaults,
  titleLabelKey,
  type CreatePaper,
} from "./createDocument";
import { Group } from "./Group";

type SourceMode = "file" | "text";

const SOURCE_MODES: SourceMode[] = ["file", "text"];

export function CreatePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabParam(CREATE_TABS, "document");
  const modeSwitch = <Segmented value={tab} options={CREATE_TABS} labelOf={(value) => t(`tools.create.tabs.${value}`)} onChange={setTab} ariaLabel={t("tools.create.tabs.label")} />;
  if (tab === "bulk") return <BulkCreator key="bulk" modeSwitch={modeSwitch} />;
  if (tab === "paper") return <PaperCreator key="paper" modeSwitch={modeSwitch} />;
  return <DocumentCreator key="document" modeSwitch={modeSwitch} />;
}

function DocumentCreator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const operation = useOperation(createDocument);
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [template, setTemplate] = useState<CreateTemplate>("report");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState(() => longDate(new Date(), locale));
  const [font, setFont] = useState<CreateFont>("sans");
  const [fontSize, setFontSize] = useState(11);
  const [marginMm, setMarginMm] = useState(20);
  const [paper, setPaper] = useState<CreatePaper>("a4");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [logo, setLogo] = useState<string | null>(null);
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [pageNumbers, setPageNumbers] = useState(true);
  const [pageNumberFormat, setPageNumberFormat] = useState(() => t("tools.create.pageNumberDefault"));
  const [output, setOutput] = useState("");

  const hasContent = sourceMode === "file" ? sourcePath !== null : text.trim().length > 0;

  useEffect(() => {
    if (sourceMode === "file" && sourcePath) {
      setOutput(siblingPath(sourcePath, "pdf"));
      return;
    }
    if (sourceMode !== "text") return;
    let live = true;
    const name = sanitizeFileName(title.trim()) || t("tools.create.defaultName");
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput(joinPath(directory, `${name}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [sourceMode, sourcePath, title, t]);

  useEffect(() => {
    const store = useDropTargetStore.getState();
    store.setHandler((paths) => {
      const dropped = paths.find((path) => TEXT_SOURCE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? ""));
      if (!dropped) return;
      setSourceMode("file");
      setSourcePath(dropped);
    });
    return () => store.setHandler(null);
  }, []);

  const chooseTemplate = (next: CreateTemplate) => {
    setTemplate(next);
    const defaults = templateDefaults(next, paper);
    setFont(defaults.font);
    setPaper(defaults.paper);
    setFontSize(defaults.fontSize);
  };

  const pickSource = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.textFiles"), extensions: TEXT_SOURCE_EXTENSIONS }] });
    if (typeof selected === "string") setSourcePath(selected);
  };

  const pickLogo = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.logoFiles"), extensions: LOGO_EXTENSIONS }] });
    if (typeof selected === "string") setLogo(selected);
  };

  const run = () => {
    if (!hasContent || !output) return;
    void operation.run({
      ...(sourceMode === "file" && sourcePath ? { path: sourcePath } : { text }),
      template,
      title,
      author,
      date,
      font,
      fontSize,
      marginMm,
      accent,
      logo: logo ?? undefined,
      header,
      footer,
      pageNumbers,
      pageNumberFormat,
      paper,
      output,
    });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("nav.create")}
      icon={FilePlus2}
      description={t("tools.create.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!hasContent || !output}>
          {t("tools.create.run")}
        </Button>
      }
      form={
        <fieldset disabled={operation.running} className="contents">
          <Section>{modeSwitch}</Section>
          <Section title={t("tools.create.source")}>
            <Segmented value={sourceMode} options={SOURCE_MODES} labelOf={(mode) => t(`tools.create.sourceModes.${mode}`)} onChange={setSourceMode} ariaLabel={t("tools.create.source")} />
            {sourceMode === "file" ? (
              sourcePath ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={sourcePath}>
                    {basenameOf(sourcePath)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void pickSource()}>
                    {t("tools.create.change")}
                  </Button>
                </div>
              ) : (
                <FileDropArea title={t("tools.create.pickTitle")} description={t("tools.create.pickDescription")} icon={FileText} onPick={() => void pickSource()} />
              )
            ) : (
              <Field label={t("tools.create.text")} hint={t("tools.create.textHint")}>
                <TextArea rows={10} value={text} onChange={(event) => setText(event.target.value)} aria-label={t("tools.create.text")} />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">{t("tools.create.structureHint")}</p>
          </Section>
          <Section title={t("tools.create.template")}>
            <OptionCards
              value={template}
              onChange={chooseTemplate}
              ariaLabel={t("tools.create.template")}
              options={CREATE_TEMPLATES.map((value) => ({ value, title: t(`tools.create.templates.${value}.title`), description: t(`tools.create.templates.${value}.description`) }))}
            />
          </Section>
          <Section title={t("tools.create.details")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t(titleLabelKey(template))}>
                <TextInput value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} aria-label={t(titleLabelKey(template))} />
              </Field>
              <Field label={t(authorLabelKey(template))}>
                <TextInput value={author} maxLength={300} onChange={(event) => setAuthor(event.target.value)} aria-label={t(authorLabelKey(template))} />
              </Field>
              <Field label={t("tools.create.fields.date")}>
                <TextInput value={date} maxLength={80} onChange={(event) => setDate(event.target.value)} aria-label={t("tools.create.fields.date")} />
              </Field>
            </div>
          </Section>
          <Section title={t("tools.create.look")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("tools.create.font")}>
                <Segmented value={font} options={CREATE_FONTS} labelOf={(value) => t(`tools.create.fonts.${value}`)} onChange={setFont} ariaLabel={t("tools.create.font")} />
              </Field>
              <Field label={t("tools.create.paper")}>
                <Segmented value={paper} options={CREATE_PAPERS} labelOf={(value) => t(`tools.create.papers.${value}`)} onChange={setPaper} ariaLabel={t("tools.create.paper")} />
              </Field>
              <SliderField label={t("tools.create.fontSize")} value={fontSize} min={9} max={16} step={0.5} onChange={setFontSize} format={(value) => `${value} pt`} />
              <SliderField label={t("tools.create.margins")} value={marginMm} min={10} max={40} onChange={setMarginMm} format={(value) => `${value} mm`} />
            </div>
            <Group label={t("tools.create.accent")}>
              <ColorSwatch value={accent} onChange={setAccent} label={t("tools.create.accent")} customLabel={t("tools.create.customColor")} />
            </Group>
            <Group label={t("tools.create.logo")} hint={t("tools.create.logoHint")}>
              {logo ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={logo}>
                    {basenameOf(logo)}
                  </span>
                  <IconButton icon={X} label={t("tools.create.removeLogo")} onClick={() => setLogo(null)} />
                </div>
              ) : (
                <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void pickLogo()}>
                  {t("tools.create.pickLogo")}
                </Button>
              )}
            </Group>
          </Section>
          <Section title={t("tools.create.furniture")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("tools.create.header")}>
                <TextInput value={header} maxLength={200} onChange={(event) => setHeader(event.target.value)} aria-label={t("tools.create.header")} />
              </Field>
              <Field label={t("tools.create.footer")}>
                <TextInput value={footer} maxLength={200} onChange={(event) => setFooter(event.target.value)} aria-label={t("tools.create.footer")} />
              </Field>
            </div>
            <Checkbox label={t("tools.create.pageNumbers")} checked={pageNumbers} onChange={setPageNumbers} />
            {pageNumbers ? (
              <Field label={t("tools.create.pageNumberFormat")} hint={t("tools.create.pageNumberFormatHint")}>
                <TextInput value={pageNumberFormat} maxLength={60} onChange={(event) => setPageNumberFormat(event.target.value)} className="w-56 font-mono" aria-label={t("tools.create.pageNumberFormat")} />
              </Field>
            ) : null}
          </Section>
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
        </fieldset>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("tools.create.resultCaption", { count: result.pageCount }) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={FilePlus2}
          idleTitle={t("tools.create.idle.title")}
          idleDescription={t("tools.create.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}
