import { useEffect, useState, type ReactNode } from "react";
import { NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Checkbox, Field, OptionCards, Section, Segmented, SliderField } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { PaperPreview } from "@/features/pages/PaperPreview";
import { DEFAULT_PAPER_COLOR, DEFAULT_SPACING, PAPER_SPACING, PAPER_STYLES } from "@/features/pages/paperPattern";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import { createPaper } from "@/shared/rpc/operations";
import type { CreatePaperSize, PaperPattern } from "@/types";
import { MAX_PAPER_PAGES, PAPER_SIZES, PAPER_SIZE_POINTS, type PaperChoice } from "./paperDocument";

const ORIENTATIONS = ["portrait", "landscape"] as const;
const CHOICES: PaperChoice[] = ["plain", ...PAPER_STYLES];
const THUMBNAIL: [number, number] = [120, 170];

export function PaperCreator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { t } = useTranslation();
  const operation = useOperation(createPaper);
  const [choice, setChoice] = useState<PaperChoice>("lined");
  const [size, setSize] = useState<CreatePaperSize>("a4");
  const [landscape, setLandscape] = useState(false);
  const [pages, setPages] = useState(20);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING.lined);
  const [color, setColor] = useState(DEFAULT_PAPER_COLOR);
  const [margin, setMargin] = useState(true);
  const [output, setOutput] = useState("");

  const pattern: PaperPattern | undefined = choice === "plain" ? undefined : { style: choice, spacing, color, margin: choice === "lined" && margin };
  let [width, height] = PAPER_SIZE_POINTS[size];
  if (landscape) [width, height] = [height, width];

  useEffect(() => {
    let live = true;
    const name = sanitizeFileName(t(`tools.pages.paper.${choice}`)) || t("tools.create.paper.defaultName");
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput(joinPath(directory, `${name}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [choice, t]);

  const choose = (next: PaperChoice) => {
    setChoice(next);
    if (next !== "plain") setSpacing(DEFAULT_SPACING[next]);
  };

  const ready = output.length > 0 && pages >= 1 && pages <= MAX_PAPER_PAGES;
  const run = () => {
    if (!ready) return;
    void operation.run({ size, landscape, pages, pattern, output });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("tools.create.paper.title")}
      icon={NotebookPen}
      description={t("tools.create.paper.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.create.paper.run")}
        </Button>
      }
      form={
        <fieldset disabled={operation.running} className="contents">
          <Section>{modeSwitch}</Section>
          <Section title={t("tools.pages.paper.label")}>
            <OptionCards
              value={choice}
              onChange={choose}
              ariaLabel={t("tools.pages.paper.label")}
              options={CHOICES.map((value) => ({
                value,
                title: t(`tools.pages.paper.${value}`),
                description: t(`tools.create.paper.styles.${value}`),
                preview: <PaperThumbnail choice={value} color={color} />,
              }))}
            />
          </Section>
          <Section title={t("tools.create.paper.layout")}>
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-0 flex-1 space-y-4">
                <Field label={t("tools.pages.paperSize")}>
                  <Segmented value={size} options={PAPER_SIZES} labelOf={(value) => t(`tools.create.paper.sizes.${value}`)} onChange={setSize} ariaLabel={t("tools.pages.paperSize")} />
                </Field>
                <Field label={t("tools.pages.orientation")}>
                  <Segmented
                    value={landscape ? "landscape" : "portrait"}
                    options={ORIENTATIONS}
                    labelOf={(value) => t(`tools.pages.${value}`)}
                    onChange={(value) => setLandscape(value === "landscape")}
                    ariaLabel={t("tools.pages.orientation")}
                  />
                </Field>
                <SliderField label={t("tools.create.paper.pages")} value={pages} min={1} max={MAX_PAPER_PAGES} onChange={setPages} format={(value) => t("tools.create.paper.pageCount", { count: value })} />
                {pattern ? (
                  <>
                    <SliderField
                      label={t("tools.pages.paper.spacing")}
                      value={spacing}
                      min={PAPER_SPACING.min}
                      max={PAPER_SPACING.max}
                      step={PAPER_SPACING.step}
                      onChange={setSpacing}
                      format={(value) => t("tools.pages.paper.millimetres", { value })}
                    />
                    <Field label={t("tools.pages.paper.color")}>
                      <ColorSwatch value={color} onChange={setColor} label={t("tools.pages.paper.color")} customLabel={t("colorPicker.custom")} />
                    </Field>
                    {choice === "lined" ? <Checkbox label={t("tools.pages.paper.margin")} checked={margin} onChange={setMargin} /> : null}
                  </>
                ) : null}
              </div>
              <div className="w-36 shrink-0">
                <PaperSheet width={width} height={height} pattern={pattern} className="w-full" />
              </div>
            </div>
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
          idleIcon={NotebookPen}
          idleTitle={t("tools.create.paper.idle.title")}
          idleDescription={t("tools.create.paper.idle.description")}
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


function PaperSheet({ width, height, pattern, className }: { width: number; height: number; pattern?: PaperPattern; className: string }) {
  if (pattern) return <PaperPreview width={width} height={height} paper={pattern} className={`${className} rounded-sm border bg-card`} />;
  return <div className={`${className} rounded-sm border bg-card`} style={{ aspectRatio: `${width} / ${height}` }} aria-hidden />;
}

function PaperThumbnail({ choice, color }: { choice: PaperChoice; color: string }) {
  const pattern: PaperPattern | undefined = choice === "plain" ? undefined : { style: choice, spacing: DEFAULT_SPACING[choice], color, margin: choice === "lined" };
  return <PaperSheet width={THUMBNAIL[0]} height={THUMBNAIL[1]} pattern={pattern} className="h-16 w-12" />;
}
