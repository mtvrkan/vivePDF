import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { GitCompareArrows, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toolGroupOfRoute } from "@/app/navigation";
import { Button } from "@/components/shared/Button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Checkbox, Section, Segmented } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { suggestOutputPath } from "@/shared/lib/paths";
import { comparePdfs } from "@/shared/rpc/operations";
import { useUiStore } from "@/shared/store/uiStore";
import { areaPercent, CHANGE_FILTERS, filterCounts, isChanged, matchesFilter, pageLabel, type ChangeFilter } from "./changeFilter";
import type { CompareView } from "./CompareViewSwitch";
import { SideBySideCompare } from "./SideBySideCompare";

type CompareTab = "diff" | "sideBySide";
const TABS: CompareTab[] = ["diff", "sideBySide"];

export function ComparePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const group = toolGroupOfRoute(location.pathname, location.search);
  const locale = useUiStore((state) => state.locale);
  const first = useSourceDocument();
  const second = useSourceDocument();
  const operation = useOperation(comparePdfs);
  const [visual, setVisual] = useState(true);
  const [text, setText] = useState(true);
  const [report, setReport] = useState(true);
  const [output, setOutput] = useState("");
  const [tab, setTab] = useState<CompareTab>("diff");
  const [syncScroll, setSyncScroll] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [view, setView] = useState<CompareView>("sideBySide");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [ignorePunctuation, setIgnorePunctuation] = useState(false);
  const [ignoreMargins, setIgnoreMargins] = useState(false);

  const pathA = first.source?.path ?? null;
  const pathB = second.source?.path ?? null;
  const suffix = t("tools.compare.suffix");
  useEffect(() => {
    if (pathA) setOutput(suggestOutputPath(pathA, suffix));
  }, [pathA, suffix]);

  const resetOperation = operation.reset;
  useEffect(() => {
    resetOperation();
    setFilter("all");
  }, [pathA, pathB, resetOperation]);

  const ready = !!first.source?.info && !!second.source?.info && first.source.path !== second.source.path && (!report || !!output) && (text || visual);

  const run = () => {
    if (!first.source || !second.source || !ready) return;
    setFilter("all");
    void operation.run({
      pathA: first.source.path,
      passwordA: first.source.password ?? undefined,
      pathB: second.source.path,
      passwordB: second.source.password ?? undefined,
      output: report ? output : undefined,
      visual,
      text,
      ignoreCase,
      ignorePunctuation,
      ignoreMargins,
    });
  };

  const result = operation.result;
  const changed = result?.pages.filter(isChanged) ?? [];
  const counts = result ? filterCounts(result.pages) : null;
  const shown = changed.filter((page) => matchesFilter(page, filter));
  const secondSource = second.source && second.source.path === first.source?.path ? null : second.source;

  return (
    <div data-tone={group} className="flex h-full flex-col">
      <PageHeader
        title={t("nav.compare")}
        icon={GitCompareArrows}
        description={t("tools.compare.description")}
        tone={group}
        eyebrow={group ? t(`tools.grid.groups.${group}`) : t("nav.tools")}
        actions={
          tab === "diff" ? (
            <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
              {t("tools.compare.run")}
            </Button>
          ) : null
        }
      />
      <div className="glass-flat border-b px-6 py-3">
        <div role="tablist" className="glass inline-flex gap-1 rounded-xl p-1">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={cn(
                "h-8 rounded-lg px-4 text-sm transition-[background-color,box-shadow] duration-(--transition-fast)",
                tab === item ? "glass-chip font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tools.compare.sideBySide.tabs.${item}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === "diff" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_var(--spacing-inspector)]">
          <div className="min-h-0 overflow-auto border-e p-6">
            <div className="steps space-y-4">
              <Section title={t("tools.compare.documentA")}>
                <SourcePicker {...first} onPick={() => void first.pick()} onPassword={(password) => void first.submitPassword(password)} disabled={operation.running} />
              </Section>
              <Section title={t("tools.compare.documentB")}>
                <SourcePicker
                  source={secondSource}
                  status={second.status}
                  error={second.error}
                  needsPassword={second.needsPassword}
                  onPick={() => void second.pick()}
                  onPassword={(password) => void second.submitPassword(password)}
                  disabled={operation.running}
                />
              </Section>
              <Section title={t("tools.compare.options")}>
                <Checkbox label={t("tools.compare.text")} checked={text} onChange={setText} />
                <Checkbox label={t("tools.compare.visual")} checked={visual} onChange={setVisual} />
                <Checkbox label={t("tools.compare.report")} checked={report} onChange={setReport} />
                {report ? <OutputPathField value={output} onChange={setOutput} disabled={operation.running} /> : null}
              </Section>
              <Section title={t("tools.compare.ignoreTitle")}>
                <p className="text-xs text-muted-foreground">{t("tools.compare.ignoreHint")}</p>
                <Checkbox label={t("tools.compare.ignoreCase")} checked={ignoreCase} onChange={setIgnoreCase} disabled={!text} />
                <Checkbox label={t("tools.compare.ignorePunctuation")} checked={ignorePunctuation} onChange={setIgnorePunctuation} disabled={!text} />
                <Checkbox label={t("tools.compare.ignoreMargins")} checked={ignoreMargins} onChange={setIgnoreMargins} />
              </Section>
            </div>
          </div>
          <ResultPanel
            status={operation.status}
            progress={operation.progress}
            error={operation.error}
            numeral={result ? formatNumber(result.changedPages, locale) : undefined}
            caption={result ? t("tools.compare.caption", { added: result.addedWords, removed: result.removedWords, a: result.pagesA, b: result.pagesB }) : undefined}
            outputs={result?.output ? [result.output] : []}
            idleIcon={GitCompareArrows}
            idleTitle={t("tools.compare.idle.title")}
            idleDescription={t("tools.compare.idle.description")}
            onCancel={operation.cancel}
            onRetry={run}
            overwritePrompt={operation.overwritePrompt}
            onConfirmOverwrite={operation.confirmOverwrite}
            onDismissOverwrite={operation.dismissOverwrite}
          >
            {result ? (
              <ul className="min-h-0 overflow-auto">
                {result.output && result.reportSpreads < result.changedPages ? (
                  <li role="status" className="flex items-start gap-2 border-b px-4 py-2.5 text-sm text-muted-foreground">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t("tools.compare.reportCapped", { shown: formatNumber(result.reportSpreads, locale), count: result.changedPages })}
                  </li>
                ) : null}
                {changed.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">{t("tools.compare.identical")}</li> : null}
                {changed.length > 0 && counts ? (
                  <li className="border-b px-4 py-2">
                    <Segmented
                      size="sm"
                      value={filter}
                      options={CHANGE_FILTERS}
                      labelOf={(option) => `${t(`tools.compare.filters.${option}`)} ${counts[option]}`}
                      onChange={setFilter}
                      ariaLabel={t("tools.compare.filters.label")}
                    />
                  </li>
                ) : null}
                {changed.length > 0 && shown.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">{t("tools.compare.filters.none")}</li> : null}
                {shown.map((page) => (
                  <li key={page.page} className="border-b px-4 py-2 text-sm">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-medium text-foreground">{pageLabel(page.pageA, page.pageB)}</span>
                      {!page.inA ? <span className="text-success">{t("tools.compare.onlyB")}</span> : null}
                      {!page.inB ? <span className="text-destructive">{t("tools.compare.onlyA")}</span> : null}
                      {page.addedWords ? <span className="text-success">+{page.addedWords}</span> : null}
                      {page.removedWords ? <span className="text-destructive">−{page.removedWords}</span> : null}
                      {page.changedArea > 0.002 ? <span className="text-warning">{areaPercent(page.changedArea)} {t("tools.compare.area")}</span> : null}
                      {page.sizeChanged ? <span className="text-warning">{t("tools.compare.sizeChanged")}</span> : null}
                    </div>
                    {page.snippets.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted-foreground">
                        {page.snippets.map((snippet, index) => (
                          <li key={index} className="truncate" title={snippet}>{snippet}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </ResultPanel>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid grid-cols-2 gap-3 border-b p-4">
            <Section title={t("tools.compare.documentA")}>
              <SourcePicker {...first} onPick={() => void first.pick()} onPassword={(password) => void first.submitPassword(password)} />
            </Section>
            <Section title={t("tools.compare.documentB")}>
              <SourcePicker
                source={secondSource}
                status={second.status}
                error={second.error}
                needsPassword={second.needsPassword}
                onPick={() => void second.pick()}
                onPassword={(password) => void second.submitPassword(password)}
              />
            </Section>
          </div>
          <div className="min-h-0 flex-1">
            <SideBySideCompare
              active={tab === "sideBySide"}
              sourceA={first.source}
              sourceB={secondSource}
              pages={result?.pages ?? null}
              view={view}
              onViewChange={setView}
              syncScroll={syncScroll}
              onSyncScrollChange={setSyncScroll}
              highlight={highlight}
              onHighlightChange={setHighlight}
            />
          </div>
        </div>
      )}
    </div>
  );
}
