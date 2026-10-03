import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { PenLine, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Section } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { BookmarksTab } from "./BookmarksTab";
import { bookmarkIssue } from "./bookmarkTree";
import { ImposeTab, type ImposeSettings } from "./ImposeTab";
import { IMPOSE_GAP_MM, IMPOSE_GRID, IMPOSE_GUTTER_MM, IMPOSE_MARGIN_MM, gridOf, hasSpine } from "./imposeOrder";
import { TextEditTab } from "./TextEditTab";
import { TEXT_EDIT_SIZE } from "./textEditState";
import { PosterTab } from "./PosterTab";
import { AutoLinkTab, type AutoLinkSettings } from "./AutoLinkTab";
import { POSTER_GRID, POSTER_MARGIN_MM, POSTER_OVERLAP_MM, posterGridOf, visiblePageSize, type PosterSettings } from "./posterPlan";
import { NumberTab } from "./NumberTab";
import { HeaderFooterTab } from "./HeaderFooterTab";
import { LetterheadTab } from "./LetterheadTab";
import { CoverTab } from "./CoverTab";
import { useCoverState } from "./useCoverState";
import { FindReplaceTab } from "./FindReplaceTab";
import { CropTab } from "./CropTab";
import { ResizeTab } from "./ResizeTab";
import { FlattenTab } from "./FlattenTab";
import { RedactTab } from "./RedactTab";
import { useCropState, useFlattenState, useHeaderFooterState, useLetterheadState, useNumberState, useResizeState, useStampState } from "./editFormState";
import { useRedactState } from "./useRedactState";
import { useFindReplaceState } from "./useFindReplaceState";
import { useBookmarksState } from "./useBookmarksState";
import { useTextEditState } from "./useTextEditState";
import { MM_TO_PT, NUMBER_TOKENS, TABS, type Tab } from "./editShared";
import { repairCaption, runEdit } from "./runEdit";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { formatNumber } from "@/shared/lib/format";
import { wholeWithin, withinRange } from "@/shared/lib/numberRange";
import { rangePages } from "@/shared/lib/pageScope";
import { suggestOutputPath } from "@/shared/lib/paths";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { RepairIssues } from "@/features/tools/edit/RepairIssues";
import type { FlattenResult, LetterheadTemplateRole, TextEditWarning } from "@/types";

export function EditPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const [searchParams] = useSearchParams();
  const [tab] = useTabParam<Tab>(TABS, "number");
  const sourceState = useSourceDocument();
  const operation = useOperation(runEdit);

  const editResult = operation.result;
  useEffect(() => {
    const warnings = editResult && "warnings" in editResult ? (editResult.warnings as TextEditWarning[]) : [];
    if (warnings.length === 0) return;
    const unique = warnings.filter((warning, index) => warnings.findIndex((item) => item.code === warning.code) === index);
    toast(
      "info",
      unique
        .map((warning) => t(`viewer.editPanel.warning${warning.code[0].toUpperCase()}${warning.code.slice(1)}`, { detail: warning.detail ?? "" }))
        .join(" · "),
    );
  }, [editResult, toast, t]);
  useEffect(() => {
    const hidden = editResult && "hidden" in editResult ? Number(editResult.hidden) : 0;
    if (hidden > 0) toast("info", t("tools.edit.redact.hiddenRemoved", { count: hidden }));
  }, [editResult, toast, t]);
  useEffect(() => {
    if (editResult?.repair?.signed) toast("info", t("tools.edit.repair.signed"));
  }, [editResult, toast, t]);
  useEffect(() => {
    if (!editResult || !("hiddenAnnotations" in editResult)) return;
    const flat = editResult as unknown as FlattenResult;
    const notes = [
      flat.hiddenAnnotations > 0 ? t("tools.edit.flatten.hiddenDropped", { count: flat.hiddenAnnotations }) : "",
      flat.signatures > 0 ? t("tools.edit.flatten.signed") : "",
      flat.xfa ? t("tools.edit.flatten.xfa") : "",
    ].filter(Boolean);
    if (notes.length > 0) toast("info", notes.join(" · "));
  }, [editResult, toast, t]);
  const [output, setOutput] = useState("");
  const [pages, setPages] = useState("");
  const stamp = useStampState();
  const { marginMm, color, bold, fontId, marginValid } = stamp;
  const numberState = useNumberState();
  const { position, template, start, numberFontSize, numberPrefix, numberPadding, numberSuffix, numberStyle, numberSide, numberMirror, numberLabels, numberReplace, numberFontValid, startValid, paddingValid } = numberState;
  const headerFooterState = useHeaderFooterState();
  const { headerFontSize, header, footer, headerMode, headerStart, headerDateFormat, headerReplace, removeScope, headerFontValid } = headerFooterState;
  const letterheadState = useLetterheadState();
  const { letterheadPath, letterheadFirstPath, letterheadPosition, letterheadFit, letterheadReplace, letterheadPage, letterheadFirstPage, letterheadPassword, letterheadFirstPassword, letterheadPagesValid } = letterheadState;
  const cropState = useCropState();
  const { insets, cropMode, cropSide, cropAutoMargin, cropRemoveContent, cropSettingsValid } = cropState;
  const resizeState = useResizeState();
  const { preset, customSize, autoRotate, resizeMode, resizeMargin, resizeMatchLargest, resizeCustom, resizeWidthValid, resizeHeightValid, resizeMarginValid } = resizeState;
  const flattenState = useFlattenState();
  const { flattenAnnotations, flattenForms, flattenKeepLinks, flattenRasterize, flattenDpi, flattenImageFormat, flattenQuality, flattenPrintedOnly } = flattenState;
  const [impose, setImpose] = useState<ImposeSettings>({
    layout: "2up",
    columns: 2,
    rows: 2,
    paper: "auto",
    orientation: "auto",
    margin: 6,
    gap: 3,
    gutter: 0,
    arrangement: "rows",
    reading: "ltr",
    binding: "left",
    duplex: "both",
    flipShortEdge: false,
    creep: 0,
    scale: "fit",
    autoRotate: true,
    border: false,
    guides: false,
    pages: "",
  });
  const [poster, setPoster] = useState<PosterSettings>({
    paper: "a4",
    orientation: "auto",
    columns: 2,
    rows: 2,
    marginMm: 10,
    overlapMm: 5,
    cutMarks: true,
    labels: true,
    pages: "",
  });
  const [autoLink, setAutoLink] = useState<AutoLinkSettings>({ urls: true, emails: true, pages: "" });

  const source = sourceState.source;
  const coverState = useCoverState(source);

  useEffect(() => {
    if (source) setOutput(suggestOutputPath(source.path, t(`tools.edit.${tab}.suffix`)));
  }, [source, tab, t]);

  const {
    bookmarksLoaded,
    bookmarkOpenPanel,
    setBookmarkOpenPanel,
    bookmarkItems,
    bookmarksLoading,
    bookmarksGenerating,
    bookmarkLevels,
    setBookmarkLevels,
    bookmarkEvery,
    setBookmarkEvery,
    handleGenerateBookmarks,
    handleGenerateEveryPage,
    handleExportBookmarks,
    handleImportBookmarks,
    addBookmark,
    removeBookmark,
    updateBookmark,
    sortBookmarks,
    collapseBookmarks,
    toggleBookmark,
    indentBookmark,
    outdentBookmark,
    moveBookmark,
    bookmarkPageCount,
  } = useBookmarksState(source, tab, t, toast);

  const redactState = useRedactState(source, tab, pages, searchParams, t, toast);
  const { terms, patternList, presets, caseSensitive, redactWholeWord, redactFill, overlayText, imagesMode, graphicsMode, redactWholePages, redactScrubHidden, setPreviewCount, redactReady } = redactState;

  const { teditPage, teditSpans, teditSize, teditLoading, teditEdits, teditActiveId, setTeditActiveId, pendingTeditPage, setPendingTeditPage, goToTeditPage, changeTeditPage, applySpanEdit, removeSpanEdit } = useTextEditState(source, tab, t, toast);

  const findReplaceState = useFindReplaceState(source, pages, t, toast);
  const { findText, replaceText, findCaseSensitive, findWholeWord, findRegex } = findReplaceState;

  const sourceReadable = tab === "repair" ? !!source && sourceState.status !== "loading" && !sourceState.needsPassword : !!source?.info;
  const numberSettingsValid = numberFontValid && marginValid && startValid && paddingValid;
  const teditSizesValid = Array.from(teditEdits.values()).every((edit) => withinRange(edit.size, TEXT_EDIT_SIZE));
  const lockedTemplate = tab === "letterhead" && operation.error?.code === "NEEDS_PASSWORD" ? (operation.error.data?.which as LetterheadTemplateRole | undefined) : undefined;
  const headerSettingsValid = headerMode === "remove" || (headerFontValid && marginValid);
  const imposeGrid = gridOf(impose.layout, impose.columns, impose.rows);
  const imposeValid =
    withinRange(impose.margin, IMPOSE_MARGIN_MM) &&
    withinRange(impose.gap, IMPOSE_GAP_MM) &&
    (!hasSpine(imposeGrid[0]) || withinRange(impose.gutter, IMPOSE_GUTTER_MM)) &&
    (impose.layout !== "custom" || (wholeWithin(impose.columns, IMPOSE_GRID) && wholeWithin(impose.rows, IMPOSE_GRID)));
  const posterValid =
    wholeWithin(poster.columns, POSTER_GRID) &&
    wholeWithin(poster.rows, POSTER_GRID) &&
    withinRange(poster.marginMm, POSTER_MARGIN_MM) &&
    withinRange(poster.overlapMm, POSTER_OVERLAP_MM);
  const posterPreviewPage = rangePages(poster.pages, source?.info?.pageCount ?? 0)?.[0] ?? 1;
  const ready =
    sourceReadable &&
    !!output &&
    (tab !== "number" || numberSettingsValid) &&
    (tab !== "headerFooter" || headerSettingsValid) &&
    (tab !== "headerFooter" || headerMode === "remove" || Object.values({ ...header, ...footer }).some((value) => value.trim())) &&
    (tab !== "redact" || redactReady) &&
    (tab !== "flatten" || flattenAnnotations || flattenForms || flattenRasterize || !flattenKeepLinks) &&
    (tab !== "crop" || cropSettingsValid) &&
    (tab !== "impose" || imposeValid) &&
    (tab !== "poster" || posterValid) &&
    (tab !== "resize" || (resizeWidthValid && resizeHeightValid && resizeMarginValid)) &&
    (tab !== "number" || NUMBER_TOKENS.some((token) => template.includes(token))) &&
    (tab !== "letterhead" || (letterheadPath.length > 0 && letterheadPagesValid)) &&
    (tab !== "findReplace" || findText.trim().length > 0) &&
    (tab !== "bookmarks" || (!bookmarksLoading && (bookmarkItems.length > 0 || bookmarksLoaded) && bookmarkIssue(bookmarkItems, bookmarkPageCount) === null)) &&
    (tab !== "textedit" || (teditEdits.size > 0 && teditSizesValid)) &&
    (tab !== "autolink" || autoLink.urls || autoLink.emails) &&
    (tab !== "cover" || coverState.coverValid);

  const baseParams = () => ({ path: source?.path ?? "", password: source?.password ?? undefined, output, pages: pages.trim() || undefined });

  const run = () => {
    if (!source || !ready) return;
    const margin = marginMm * MM_TO_PT;
    const params: Record<string, unknown> =
      tab === "cover"
        ? {
          path: source.path,
          password: source.password ?? undefined,
          output,
          style: coverState.style,
          ...coverState.texts,
          logo: coverState.logo ?? undefined,
          image: coverState.style === "photo" ? coverState.image ?? undefined : undefined,
          accent: coverState.accent,
          font: coverState.font,
          replaceFirst: coverState.replaceFirst,
        }
        : tab === "number"
        ? { ...baseParams(), position, template, start, fontSize: numberFontSize, margin, color, bold, prefix: numberPrefix, suffix: numberSuffix, padding: numberPadding, fontId, style: numberStyle, side: numberSide, mirrorMargins: numberMirror, pageLabels: numberLabels, replaceExisting: numberReplace }
        : tab === "headerFooter"
          ? headerMode === "remove"
            ? { ...baseParams(), scope: removeScope }
            : { ...baseParams(), headerLeft: header.left, headerCenter: header.center, headerRight: header.right, footerLeft: footer.left, footerCenter: footer.center, footerRight: footer.right, fontSize: headerFontSize, margin, color, bold, fontId, start: headerStart, dateFormat: headerDateFormat, replaceExisting: headerReplace }
          : tab === "crop"
            ? {
              ...baseParams(),
              mode: cropMode,
              side: cropSide,
              removeContent: cropRemoveContent,
              autoMargin: cropAutoMargin * MM_TO_PT,
              insets: { left: insets.left * MM_TO_PT, top: insets.top * MM_TO_PT, right: insets.right * MM_TO_PT, bottom: insets.bottom * MM_TO_PT },
            }
            : tab === "resize"
              ? { ...baseParams(), preset: preset === "custom" || resizeMatchLargest ? undefined : preset, width: resizeCustom ? customSize.width * MM_TO_PT : undefined, height: resizeCustom ? customSize.height * MM_TO_PT : undefined, autoRotate, mode: resizeMode, margin: resizeMargin * MM_TO_PT, matchLargest: resizeMatchLargest }
              : tab === "flatten"
                ? { path: source.path, password: source.password ?? undefined, output, annotations: flattenAnnotations, forms: flattenForms, keepLinks: flattenKeepLinks, rasterize: flattenRasterize, dpi: flattenDpi, imageFormat: flattenImageFormat, jpegQuality: flattenQuality, printedOnly: flattenPrintedOnly }
                : tab === "redact"
                  ? { ...baseParams(), searchText: terms, patterns: patternList, presets, caseSensitive, wholeWord: redactWholeWord, fill: redactFill, overlayText: overlayText.trim() || undefined, images: imagesMode, graphics: graphicsMode, wholePages: redactWholePages.trim() || undefined, scrubHidden: redactScrubHidden }
                  : tab === "letterhead"
                    ? {
                      ...baseParams(),
                      templatePath: letterheadPath,
                      templatePage: letterheadPage,
                      templatePassword: letterheadPassword || undefined,
                      firstPageTemplatePath: letterheadFirstPath || undefined,
                      firstPageTemplatePage: letterheadFirstPath ? letterheadFirstPage : undefined,
                      firstPageTemplatePassword: letterheadFirstPath && letterheadFirstPassword ? letterheadFirstPassword : undefined,
                      position: letterheadPosition,
                      fit: letterheadFit,
                      replaceExisting: letterheadReplace,
                    }
                    : tab === "findReplace"
                      ? { ...baseParams(), find: findText, replace: replaceText, caseSensitive: findCaseSensitive, wholeWord: findWholeWord, regex: findRegex }
                  : tab === "impose"
                    ? {
                      path: source.path,
                      password: source.password ?? undefined,
                      output,
                      layout: impose.layout,
                      columns: imposeGrid[0],
                      rows: imposeGrid[1],
                      paper: impose.paper,
                      orientation: impose.orientation,
                      margin: impose.margin * MM_TO_PT,
                      gap: impose.gap * MM_TO_PT,
                      gutter: hasSpine(imposeGrid[0]) ? impose.gutter * MM_TO_PT : 0,
                      arrangement: impose.arrangement,
                      reading: impose.reading,
                      binding: impose.binding,
                      duplex: impose.duplex,
                      flipShortEdge: impose.flipShortEdge,
                      creep: impose.creep * MM_TO_PT,
                      scale: impose.scale,
                      autoRotate: impose.autoRotate,
                      border: impose.border,
                      guides: impose.guides,
                      pages: impose.pages.trim() || undefined,
                    }
                    : tab === "poster"
                      ? (() => {
                        const grid = posterGridOf(poster);
                        return { path: source.path, password: source.password ?? undefined, output, paper: grid.paper, orientation: grid.orientation, columns: grid.columns, rows: grid.rows, margin: grid.margin, overlap: grid.overlap, cutMarks: poster.cutMarks, labels: poster.labels, pages: poster.pages.trim() || undefined };
                      })()
                    : tab === "autolink"
                      ? { path: source.path, password: source.password ?? undefined, output, urls: autoLink.urls, emails: autoLink.emails, pages: autoLink.pages.trim() || undefined }
                    : tab === "bookmarks"
                      ? { path: source.path, password: source.password ?? undefined, output, items: bookmarkItems, openPanel: bookmarkOpenPanel }
                      : tab === "textedit"
                        ? { path: source.path, password: source.password ?? undefined, output, page: teditPage - 1, edits: Array.from(teditEdits.values()), visible: true }
                        : { path: source.path, password: source.password ?? undefined, output };
    void operation.run({ tab, params, variant: tab === "headerFooter" && headerMode === "remove" ? "remove" : undefined });
  };

  const result = operation.result;
  const removedFurniture = tab === "headerFooter" && !!result?.removedFurniture;
  const numeral = result
    ? tab === "redact" || tab === "crop" || tab === "textedit" || tab === "findReplace" || tab === "letterhead" || tab === "poster" || tab === "autolink" || tab === "number" || tab === "headerFooter"
      ? formatNumber(result.extra ?? 0, locale)
      : formatNumber(result.pageCount, locale)
    : undefined;
  const caption = result
    ? tab === "redact"
      ? t("tools.edit.redact.count")
      : tab === "crop"
        ? t("tools.edit.crop.croppedCount")
      : tab === "textedit"
        ? t("tools.edit.textedit.replacedCount")
        : tab === "findReplace"
          ? t("tools.edit.findReplace.replacedCount")
          : tab === "poster"
            ? t("tools.edit.poster.sheetsCount")
          : tab === "autolink"
            ? t("tools.edit.autolink.addedCount")
          : removedFurniture
            ? t("tools.edit.headerFooter.removedCount")
          : tab === "headerFooter"
            ? t("tools.edit.headerFooter.stampedCount")
          : tab === "number"
            ? t("tools.edit.number.stampedCount")
        : tab === "repair" && result.repair
          ? repairCaption(result.repair, t)
          : t("info.pages")
    : undefined;

  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
    setPreviewCount(null);
  }, [tab, headerMode, resetOperation, setPreviewCount]);

  return (
    <ToolLayout
      title={t(`tools.edit.${tab}.title`)}
      icon={PenLine}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t(tab === "headerFooter" && headerMode === "remove" ? "tools.edit.headerFooter.removeRun" : `tools.edit.${tab}.run`)}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />

          {tab === "number" ? (
            <NumberTab state={numberState} stamp={stamp} pages={pages} onPagesChange={setPages} running={operation.running} />
          ) : null}

          {tab === "cover" ? <CoverTab state={coverState} /> : null}

          {tab === "letterhead" ? (
            <LetterheadTab state={letterheadState} lockedTemplate={lockedTemplate} pages={pages} onPagesChange={setPages} />
          ) : null}

          {tab === "findReplace" ? (
            <FindReplaceTab state={findReplaceState} source={source} pages={pages} onPagesChange={setPages} />
          ) : null}

          {tab === "headerFooter" ? (
            <HeaderFooterTab state={headerFooterState} stamp={stamp} pages={pages} onPagesChange={setPages} running={operation.running} />
          ) : null}

          {tab === "crop" ? (
            <CropTab state={cropState} pages={pages} onPagesChange={setPages} />
          ) : null}

          {tab === "resize" ? (
            <ResizeTab state={resizeState} pages={pages} onPagesChange={setPages} />
          ) : null}

          {tab === "flatten" ? (
            <FlattenTab state={flattenState} />
          ) : null}

          {tab === "redact" ? (
            <RedactTab state={redactState} source={source} locale={locale} pages={pages} onPagesChange={setPages} />
          ) : null}

          {tab === "repair" ? (
            <Section title={t("tools.edit.repair.title")}>
              <p className="text-sm text-muted-foreground">{t("tools.edit.repair.hint")}</p>
              {sourceState.status === "error" && !sourceState.needsPassword ? (
                <p className="text-sm text-foreground" role="status">{t("tools.edit.repair.unreadable")}</p>
              ) : null}
            </Section>
          ) : null}

          {tab === "impose" ? (
            <ImposeTab settings={impose} onChange={(patch) => setImpose((state) => ({ ...state, ...patch }))} />
          ) : null}

          {tab === "poster" ? (
            <PosterTab settings={poster} onChange={(patch) => setPoster((state) => ({ ...state, ...patch }))} pageSize={visiblePageSize(source?.info?.pageSizes[posterPreviewPage - 1])} pageNumber={posterPreviewPage} />
          ) : null}

          {tab === "autolink" ? (
            <AutoLinkTab settings={autoLink} onChange={(patch) => setAutoLink((state) => ({ ...state, ...patch }))} />
          ) : null}

          {tab === "bookmarks" ? (
            <BookmarksTab
              items={bookmarkItems}
              issue={bookmarkIssue(bookmarkItems, bookmarkPageCount)}
              pageCount={bookmarkPageCount}
              loading={bookmarksLoading}
              generating={bookmarksGenerating}
              levels={bookmarkLevels}
              onLevelsChange={setBookmarkLevels}
              disabled={operation.running || !source?.info}
              onAdd={addBookmark}
              onRemove={removeBookmark}
              onMove={moveBookmark}
              onIndent={indentBookmark}
              onOutdent={outdentBookmark}
              onChange={updateBookmark}
              onGenerate={() => void handleGenerateBookmarks()}
              every={bookmarkEvery}
              onEveryChange={setBookmarkEvery}
              onGenerateEvery={() => void handleGenerateEveryPage()}
              onImport={() => void handleImportBookmarks()}
              onExport={() => void handleExportBookmarks()}
              busy={bookmarksGenerating}
              onSort={sortBookmarks}
              onCollapseAll={collapseBookmarks}
              onToggle={toggleBookmark}
              openPanel={bookmarkOpenPanel}
              onOpenPanelChange={setBookmarkOpenPanel}
            />
          ) : null}

          {tab === "textedit" ? (
            <TextEditTab
              sourcePath={source?.path ?? null}
              password={source?.password ?? null}
              page={teditPage}
              pageCount={source?.info?.pageCount ?? 1}
              onPageChange={changeTeditPage}
              loading={teditLoading}
              size={teditSize}
              spans={teditSpans}
              edits={teditEdits}
              activeId={teditActiveId}
              onSelectSpan={setTeditActiveId}
              onEditChange={applySpanEdit}
              onRemoveEdit={removeSpanEdit}
              disabled={operation.running || !source?.info}
            />
          ) : null}
          <Dialog open={pendingTeditPage !== null} title={t("tools.edit.textedit.discardTitle")} onClose={() => setPendingTeditPage(null)}>
            <p className="text-sm text-muted-foreground">{t("tools.edit.textedit.discardBody", { page: pendingTeditPage ?? teditPage })}</p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="ghost" onClick={() => setPendingTeditPage(null)}>{t("common.cancel")}</Button>
              <Button variant="destructive" onClick={() => pendingTeditPage !== null && goToTeditPage(pendingTeditPage)}>{t("tools.edit.textedit.discard")}</Button>
            </div>
          </Dialog>

          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
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
          numeral={numeral}
          caption={caption}
          outputs={result ? [result.output] : []}
          idleIcon={PenLine}
          idleTitle={t("tools.edit.idle.title")}
          idleDescription={t("tools.edit.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {tab === "repair" && result?.repair ? <RepairIssues result={result.repair} /> : null}
          {(tab === "number" || tab === "headerFooter") && result?.missingGlyphs ? (
            <p role="status" className="flex items-start gap-2 px-4 py-2.5 text-sm text-foreground/80">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("tools.edit.missingGlyphs", { characters: Array.from(result.missingGlyphs).join(" ") })}
            </p>
          ) : null}
          {tab === "redact" && (result?.imagesKept ?? 0) > 0 ? (
            <p role="status" className="flex items-start gap-2 px-4 py-2.5 text-sm text-foreground/80">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("tools.edit.redact.imagesKept", { count: result?.imagesKept ?? 0 })}
            </p>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
