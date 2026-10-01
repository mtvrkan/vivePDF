import { useEffect, useState } from "react";
import { FileOutput, LayoutGrid, RotateCw, Trash2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Field, Section, Segmented, SwitchField, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { formatNumber } from "@/shared/lib/format";
import { PAGE_SCOPE_KINDS, scopePages } from "@/shared/lib/pageScope";
import { joinPath, outputDirectoryFor, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import type { RpcCallOptions } from "@/shared/rpc/client";
import { deletePages, extractPages, rotatePages, splitPdf } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import type { PageScope, PageScopeKind } from "@/types";

type Tab = "rotate" | "delete" | "extract";
type Degrees = 90 | 180 | 270;

const TABS: Tab[] = ["rotate", "delete", "extract"];
const DEGREES: Degrees[] = [90, 180, 270];
const ICONS: Record<Tab, LucideIcon> = { rotate: RotateCw, delete: Trash2, extract: FileOutput };
const TITLES: Record<Tab, string> = { rotate: "tools.grid.rotate", delete: "tools.grid.deletePages", extract: "tools.grid.extractPages" };

type PageToolParams = {
  tab: Tab;
  path: string;
  password?: string;
  output: string;
  outputDir: string;
  overwrite?: boolean;
  scope: PageScope;
  pages: number[];
  degrees: Degrees;
  separate: boolean;
  remainder?: string;
};

type PageToolResult = { outputs: string[]; affected: number };

async function runPageTool(params: PageToolParams, options: RpcCallOptions): Promise<PageToolResult> {
  const base = { path: params.path, password: params.password, overwrite: params.overwrite };
  const affected = params.pages.length;
  if (params.tab === "rotate") {
    const result = await rotatePages({ ...base, output: params.output, scope: params.scope, degrees: params.degrees }, options);
    return { outputs: [result.output], affected };
  }
  if (params.tab === "delete") {
    const result = await deletePages({ ...base, output: params.output, scope: params.scope }, options);
    return { outputs: [result.output], affected };
  }
  const outputs = params.separate
    ? (await splitPdf({ ...base, mode: "ranges", ranges: params.pages.join(";"), outputDir: params.outputDir, pattern: "{name}-p{first}" }, options)).outputs.map((part) => part.output)
    : [(await extractPages({ ...base, output: params.output, scope: params.scope }, options)).output];
  if (params.remainder) outputs.push((await deletePages({ ...base, output: params.remainder, scope: params.scope }, options)).output);
  return { outputs, affected };
}

export function PageToolsPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [tab] = useTabParam<Tab>(TABS, "rotate");
  const sourceState = useSourceDocument();
  const operation = useOperation(runPageTool);
  const { openPath } = useOpenPdf("/pages");
  const [kind, setKind] = useState<PageScopeKind>("all");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState(2);
  const [start, setStart] = useState(1);
  const [degrees, setDegrees] = useState<Degrees>(90);
  const [separate, setSeparate] = useState(false);
  const [keepRest, setKeepRest] = useState(false);
  const [output, setOutput] = useState("");
  const [outputDir, setOutputDir] = useState("");

  const source = sourceState.source;
  const pageCount = source?.info?.pageCount ?? 0;
  const scope: PageScope = { kind, ranges: kind === "ranges" ? ranges : undefined, every: kind === "every" ? every : undefined, start: kind === "every" ? start : undefined };
  const pages = source?.info ? scopePages(scope, pageCount) : null;
  const everyPage = pages !== null && pages.length === pageCount;
  const Icon = ICONS[tab];

  useEffect(() => {
    if (!source) return;
    setOutput(suggestOutputPath(source.path, t(`tools.pageTools.${tab}Suffix`)));
    setOutputDir(joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.pageTools.extractSuffix")}`));
  }, [source, tab, t]);

  const problem = !source?.info
    ? null
    : pages === null
      ? kind === "ranges" && !ranges.trim()
        ? null
        : t("tools.pageTools.invalid")
      : pages.length === 0
        ? t("tools.pageTools.noMatch")
        : tab === "delete" && everyPage
          ? t("tools.pageTools.allDeleted")
          : null;
  const writesRest = tab === "extract" && keepRest && !everyPage;
  const ready = !!source?.info && pages !== null && pages.length > 0 && !problem && (separate && tab === "extract" ? outputDir.length > 0 : output.length > 0);

  const run = () => {
    if (!source || !ready || !pages) return;
    void operation.run({
      tab,
      path: source.path,
      password: source.password ?? undefined,
      output,
      outputDir,
      scope,
      pages,
      degrees,
      separate: tab === "extract" && separate,
      remainder: writesRest ? suggestOutputPath(source.path, t("tools.pageTools.remainderSuffix")) : undefined,
    });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t(TITLES[tab])}
      icon={Icon}
      description={t(`tools.pageTools.description.${tab}`)}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t(`tools.pageTools.run.${tab}`, { count: pages?.length ?? 0 })}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          <Section title={t("tools.pageTools.pages")}>
            <Segmented value={kind} options={PAGE_SCOPE_KINDS} labelOf={(value) => t(`tools.pageTools.scope.${value}`)} onChange={setKind} ariaLabel={t("tools.pageTools.pages")} className="flex-wrap" />
            {kind === "every" ? (
              <div className="flex flex-wrap gap-4">
                <Field label={t("tools.pageTools.every")}>
                  <TextInput type="number" min={1} value={every} onChange={(event) => setEvery(Math.max(1, Math.floor(Number(event.target.value)) || 1))} className="w-28 font-mono" />
                </Field>
                <Field label={t("tools.pageTools.start")}>
                  <TextInput type="number" min={1} max={pageCount || undefined} value={start} onChange={(event) => setStart(Math.max(1, Math.floor(Number(event.target.value)) || 1))} className="w-28 font-mono" />
                </Field>
              </div>
            ) : null}
            {kind === "ranges" ? (
              <Field label={t("tools.pageTools.ranges", { total: pageCount })} hint={t("tools.pageTools.rangesHint")}>
                <TextInput autoFocus value={ranges} onChange={(event) => setRanges(event.target.value)} placeholder="1-3, 7, 10-" className="font-mono" aria-invalid={problem !== null && kind === "ranges" ? true : undefined} />
              </Field>
            ) : null}
            {source?.info ? (
              <p role="status" className={problem ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {problem ?? (pages ? t("tools.pageTools.count", { count: pages.length, total: pageCount }) : t("tools.pageTools.rangesEmpty"))}
              </p>
            ) : null}
            <div>
              <Button size="sm" variant="ghost" icon={<LayoutGrid className="size-4" aria-hidden />} disabled={!source || operation.running} onClick={() => source && void openPath(source.path)}>
                {t("tools.pageTools.openOrganizer")}
              </Button>
            </div>
          </Section>
          {tab === "rotate" ? (
            <Section title={t("tools.pageTools.degrees.title")}>
              <Segmented value={degrees} options={DEGREES} labelOf={(value) => t(`tools.pageTools.degrees.${value}`)} onChange={setDegrees} ariaLabel={t("tools.pageTools.degrees.title")} />
            </Section>
          ) : null}
          {tab === "extract" ? (
            <Section title={t("tools.pageTools.options")}>
              <SwitchField label={t("tools.pageTools.separate")} hint={t("tools.pageTools.separateHint")} checked={separate} onChange={setSeparate} disabled={operation.running} />
              <SwitchField label={t("tools.pageTools.keepRest")} hint={t("tools.pageTools.keepRestHint")} checked={keepRest} onChange={setKeepRest} disabled={operation.running || everyPage} />
            </Section>
          ) : null}
          <Section>
            {tab === "extract" && separate ? <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} /> : <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />}
          </Section>
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? formatNumber(result.affected, locale) : undefined}
          caption={result ? t(`tools.pageTools.done.${tab}`, { count: result.affected }) : undefined}
          outputs={result?.outputs ?? []}
          idleIcon={Icon}
          idleTitle={t("tools.pageTools.idle.title")}
          idleDescription={t(`tools.pageTools.idle.${tab}`)}
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
