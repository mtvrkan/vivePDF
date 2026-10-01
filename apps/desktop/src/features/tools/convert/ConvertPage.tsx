import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { defaultOcrLanguages } from "@/app/locales";
import { Button } from "@/components/shared/Button";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes, formatNumber } from "@/shared/lib/format";
import { pathKinds } from "@/shared/lib/pathKinds";
import { basenameOf, defaultOutputDirectory, extensionOf, joinPath, outputDirectoryFor, siblingPath, stemOf } from "@/shared/lib/paths";
import { sheetLabels } from "@/shared/lib/sheetLabels";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useUiStore } from "@/shared/store/uiStore";
import { FROM_PDF, IMAGE_EXTENSIONS, SVG_EXTENSIONS, TO_PDF, isConvertMode, pageList, svgWritesOneFile, type ConversionEntry, type ConvertMode } from "./conversions";
import { FileToPdfSection } from "./FileToPdfSection";
import { FromPdfSection } from "./FromPdfSection";
import { ImagesToPdfSection } from "./ImagesToPdfSection";
import { ModeList } from "./ModeList";
import { runConversion } from "./runConversion";
import { SvgToPdfSection } from "./SvgToPdfSection";
import { UrlToPdfSection } from "./UrlToPdfSection";
import { useConvertOptions } from "./useConvertOptions";
import { fileNameFromUrl } from "./urlName";

export function ConvertPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get("mode");
  const [mode, setMode] = useState<ConvertMode>(isConvertMode(initialMode) ? initialMode : "docx");
  const sourceState = useSourceDocument();
  const operation = useOperation(runConversion);
  const tools = useToolsStatusStore((state) => state.tools);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const [output, setOutput] = useState("");
  const [outputTouched, setOutputTouched] = useState(false);
  const [outputDir, setOutputDir] = useState("");
  const [pages, setPages] = useState("");
  const options = useConvertOptions();
  const { format, dpi, quality, layout, paper, images, setImages, folders, setFolders, recursive, sort, pageSize, orientation, margin, files, setFiles, svgFiles, setSvgFiles, combineSvg, url, readerMode, includeImages, split, bookTitle, bookAuthor, sheets, xlsxFormat, borderless, single, transparent, gray, archive, ocr, pictures, headerFooter, fit, cover, pptxMode } = options;

  const entry = useMemo(() => [...FROM_PDF, ...TO_PDF].find((item) => item.mode === mode) as ConversionEntry, [mode]);
  const fromPdf = FROM_PDF.some((item) => item.mode === mode);
  const source = sourceState.source;
  const sourcePath = source?.path;
  const outputExtension = mode === "xlsx" ? xlsxFormat : entry.extension === "png" ? format : entry.extension;
  const ocrLanguages = useMemo(() => {
    const available = tools?.ocrLanguages ?? [];
    return defaultOcrLanguages(locale).filter((code) => available.includes(code));
  }, [tools, locale]);

  useEffect(() => {
    setPages("");
  }, [sourcePath]);

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

  const resetOperation = operation.reset;
  useEffect(() => {
    if (!isConvertMode(initialMode) || initialMode === mode) return;
    setMode(initialMode);
    resetOperation();
  }, [initialMode, mode, resetOperation]);

  useEffect(() => {
    if (fromPdf && source) {
      setOutput(siblingPath(source.path, outputExtension));
      setOutputDir(joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.convert.imagesSuffix")}`));
    }
  }, [fromPdf, source, mode, outputExtension, t]);

  useEffect(() => {
    if (mode === "images-to-pdf") {
      const first = images[0] ?? (folders[0] ? joinPath(folders[0], "x") : "");
      if (first && !output.endsWith(".pdf")) setOutput(joinPath(outputDirectoryFor(first), `${t("tools.convert.albumName")}.pdf`));
      if (first && output === "") setOutput(joinPath(outputDirectoryFor(first), `${t("tools.convert.albumName")}.pdf`));
    }
  }, [mode, images, folders, output, t]);

  const firstFile = files[0] ?? "";
  useEffect(() => {
    if (mode !== "file-to-pdf" || !firstFile) return;
    setOutput(siblingPath(firstFile, "pdf"));
    setOutputDir(outputDirectoryFor(firstFile));
  }, [mode, firstFile]);

  const firstSvg = svgFiles[0] ?? "";
  useEffect(() => {
    if (mode !== "svg-to-pdf" || !firstSvg) return;
    setOutput(siblingPath(firstSvg, "pdf"));
    setOutputDir(outputDirectoryFor(firstSvg));
  }, [mode, firstSvg]);

  useEffect(() => {
    if (mode !== "url-to-pdf" || outputTouched) return;
    const name = fileNameFromUrl(url);
    if (!name) return;
    let cancelled = false;
    void defaultOutputDirectory().then((directory) => {
      if (!cancelled) setOutput(joinPath(directory, `${name}.pdf`));
    });
    return () => {
      cancelled = true;
    };
  }, [mode, url, outputTouched]);

  const editOutput = useCallback((value: string) => {
    setOutputTouched(true);
    setOutput(value);
  }, []);

  const selectMode = (next: ConvertMode) => {
    if (next !== mode) {
      setOutput("");
      setOutputDir("");
      setOutputTouched(false);
    }
    setMode(next);
    operation.reset();
    setSearchParams({ mode: next });
  };

  const handleDrop = useCallback(
    (paths: string[]) => {
      if (mode === "images-to-pdf") {
        void pathKinds(paths).then((kinds) => {
          const dropped = paths.filter((path, index) => kinds[index] === "file" && IMAGE_EXTENSIONS.includes(extensionOf(path)));
          const dirs = paths.filter((_, index) => kinds[index] === "directory");
          setImages((state) => [...state, ...dropped.filter((item) => !state.includes(item))]);
          setFolders((state) => [...state, ...dirs.filter((item) => !state.includes(item))]);
        });
      } else if (mode === "svg-to-pdf") {
        void pathKinds(paths).then((kinds) => {
          const dropped = paths.filter((path, index) => kinds[index] === "file" && SVG_EXTENSIONS.includes(extensionOf(path)));
          setSvgFiles((state) => [...state, ...dropped.filter((item) => !state.includes(item))]);
        });
      } else if (mode === "file-to-pdf") {
        void pathKinds(paths).then((kinds) => {
          const dropped = paths.filter((path, index) => kinds[index] === "file" && extensionOf(path) !== "pdf");
          setFiles((state) => [...state, ...dropped.filter((item) => !state.includes(item))]);
        });
      } else if (paths[0] && extensionOf(paths[0]) === "pdf") {
        void sourceState.setPath(paths[0]);
      }
    },
    [mode, sourceState, setImages, setFolders, setFiles, setSvgFiles],
  );

  useEffect(() => {
    const setHandler = useDropTargetStore.getState().setHandler;
    setHandler(handleDrop);
    return () => setHandler(null);
  }, [handleDrop]);

  useEffect(() => {
    if (mode !== "file-to-pdf" && mode !== "images-to-pdf" && mode !== "svg-to-pdf") return;
    const pending = useLaunchStore.getState().consumeIf((path) => (mode === "svg-to-pdf" ? SVG_EXTENSIONS.includes(extensionOf(path)) : extensionOf(path) !== "pdf"));
    if (!pending) return;
    if (mode === "images-to-pdf") setImages((state) => (state.includes(pending) ? state : [...state, pending]));
    else if (mode === "svg-to-pdf") setSvgFiles((state) => (state.includes(pending) ? state : [...state, pending]));
    else setFiles((state) => (state.includes(pending) ? state : [...state, pending]));
  }, [mode, setImages, setFiles, setSvgFiles]);

  const missingTool = entry.requires && tools && !tools[entry.requires] ? entry.requires : null;
  const ready = fromPdf
    ? !!source?.info && (mode === "images" || mode === "extract-images" ? !!outputDir : !!output) && !missingTool
    : mode === "images-to-pdf"
      ? images.length + folders.length > 0 && !!output
      : mode === "url-to-pdf"
        ? !!fileNameFromUrl(url) && !!output
        : mode === "svg-to-pdf"
          ? svgFiles.length > 0 && (svgWritesOneFile(svgFiles.length, combineSvg) ? !!output : !!outputDir)
          : files.length > 0 && !!output;

  const run = () => {
    if (!ready) return;
    void operation.run({
      mode,
      source: fromPdf && source ? { path: source.path, password: source.password ?? undefined } : undefined,
      output,
      outputDir,
      pages: pages.trim() || undefined,
      sheetLabels: sheetLabels((key) => t(key)),
      options: {
        format,
        dpi,
        quality,
        layout,
        paper,
        images,
        folders,
        recursive,
        sort,
        pageSize,
        orientation,
        margin,
        files,
        svgFiles,
        combineSvg,
        url,
        readerMode,
        includeImages,
        split,
        language: locale,
        title: bookTitle,
        author: bookAuthor,
        sheets,
        xlsxFormat,
        borderless,
        single,
        transparent,
        gray,
        archive,
        ocr,
        ocrLanguages,
        pictures,
        headerFooter,
        fit,
        cover,
        pptxMode,
      },
    });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("nav.convert")}
      group={fromPdf ? "fromPdf" : "toPdf"}
      icon={ArrowLeftRight}
      description={t("tools.convert.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.convert.run")}
        </Button>
      }
      form={
        <div className="grid grid-cols-[13rem_1fr] gap-4">
          <nav className="self-start rounded-md border bg-card pb-2">
            <ModeList title={t("tools.convert.fromPdf")} entries={FROM_PDF} mode={mode} onSelect={selectMode} tools={tools} />
            <ModeList title={t("tools.convert.toPdf")} entries={TO_PDF} mode={mode} onSelect={selectMode} tools={tools} />
          </nav>
          <div className="space-y-4">
            <h2 className="text-base font-semibold">{t(`tools.convert.modes.${mode}`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`tools.convert.hints.${mode}`)}</p>
            {missingTool ? (
              <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
                {t(`tools.convert.missing.${missingTool}`)}
              </p>
            ) : null}

            {fromPdf ? (
              <FromPdfSection
                mode={mode}
                sourceState={sourceState}
                running={operation.running}
                pages={pages}
                setPages={setPages}
                output={output}
                setOutput={editOutput}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                outputExtension={outputExtension}
                options={options}
                ocrLanguages={ocrLanguages}
              />
            ) : null}

            {mode === "images-to-pdf" ? (
              <ImagesToPdfSection running={operation.running} output={output} setOutput={editOutput} options={options} />
            ) : null}

            {mode === "file-to-pdf" ? (
              <FileToPdfSection
                running={operation.running}
                tools={tools}
                output={output}
                setOutput={editOutput}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                options={options}
              />
            ) : null}

            {mode === "svg-to-pdf" ? (
              <SvgToPdfSection
                running={operation.running}
                tools={tools}
                output={output}
                setOutput={editOutput}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                options={options}
              />
            ) : null}

            {mode === "url-to-pdf" ? (
              <UrlToPdfSection running={operation.running} ready={ready} run={run} output={output} setOutput={editOutput} options={options} />
            ) : null}
          </div>
        </div>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? formatNumber(result.count, locale) : undefined}
          caption={
            result
              ? [t(`tools.convert.count.${result.label}`), formatBytes(result.bytes, locale), result.skipped ? t("tools.convert.skipped", { count: result.skipped }) : null]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          outputs={result?.outputs ?? []}
          idleIcon={ArrowLeftRight}
          idleTitle={t("tools.convert.idle.title")}
          idleDescription={t("tools.convert.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {result?.failed?.length ? (
            <div role="status" className="px-4 py-2.5 text-sm">
              <p className="font-medium text-warning">{t("tools.convert.failedFiles", { total: result.failed.length })}</p>
              <ul className="mt-1 space-y-0.5">
                {result.failed.map((item) => (
                  <li key={item.path} className="text-muted-foreground">
                    <span className="text-foreground">{basenameOf(item.path)}</span> · {describeError(t, item.error)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result?.skippedPages?.length ? (
            <p role="status" className="px-4 py-2.5 text-sm text-warning">
              {t("tools.convert.skippedPages", { count: result.skippedPages.length, pages: pageList(result.skippedPages) })}
            </p>
          ) : null}
          {result?.reducedPages?.length ? (
            <p role="status" className="px-4 py-2.5 text-sm text-warning">
              {t("tools.convert.reducedPages", { count: result.reducedPages.length, pages: pageList(result.reducedPages) })}
            </p>
          ) : null}
          {result?.noTables ? (
            <p role="status" className="px-4 py-2.5 text-sm text-muted-foreground">
              {t("tools.convert.noTablesFound")}
            </p>
          ) : null}
          {result?.textPages?.length ? (
            <p role="status" className="px-4 py-2.5 text-sm text-muted-foreground">
              {t("tools.convert.textSheet", { count: result.textPages.length, pages: pageList(result.textPages), sheet: t("tools.convert.sheetLabels.text") })}
            </p>
          ) : null}
          {result?.ocrPages?.length ? (
            <p role="status" className="px-4 py-2.5 text-sm text-muted-foreground">
              {t("tools.convert.ocrPages", { count: result.ocrPages.length, pages: pageList(result.ocrPages) })}
            </p>
          ) : null}
          {result?.headerFooterMoved ? (
            <p role="status" className="px-4 py-2.5 text-sm text-muted-foreground">
              {t("tools.convert.headerFooterMoved")}
            </p>
          ) : null}
          {result?.pictures ? (
            <p role="status" className="px-4 py-2.5 text-sm text-muted-foreground">
              {result.pictures.folder
                ? t("tools.convert.picturesSaved", { count: result.pictures.count, folder: basenameOf(result.pictures.folder) })
                : t("tools.convert.picturesEmbedded", { count: result.pictures.count })}
            </p>
          ) : null}
          {result?.textless ? (
            <p role="status" className="px-4 py-2.5 text-sm text-warning">
              {t(`tools.convert.${result.textless.key}`, { count: result.textless.pages.length, pages: pageList(result.textless.pages) })}
            </p>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
