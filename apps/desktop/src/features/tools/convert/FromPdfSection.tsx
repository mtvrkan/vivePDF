import { useTranslation } from "react-i18next";
import { Checkbox, Field, Section, SelectInput, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { SourcePicker } from "@/components/tool/SourcePicker";
import type { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { stemOf } from "@/shared/lib/paths";
import type { ImageFormat, MarkdownPictures, PptxMode, XlsxFormat, XlsxSheets } from "@/types";
import type { ConvertMode } from "./conversions";
import type { ConvertOptions } from "./useConvertOptions";

const READS_TEXT = new Set<ConvertMode>(["text", "markdown", "html", "epub"]);

export function FromPdfSection({
  mode,
  sourceState,
  running,
  pages,
  setPages,
  output,
  setOutput,
  outputDir,
  setOutputDir,
  outputExtension,
  options,
  ocrLanguages,
}: {
  mode: ConvertMode;
  sourceState: ReturnType<typeof useSourceDocument>;
  running: boolean;
  pages: string;
  setPages: (value: string) => void;
  output: string;
  setOutput: (value: string) => void;
  outputDir: string;
  setOutputDir: (value: string) => void;
  outputExtension: string;
  options: ConvertOptions;
  ocrLanguages: string[];
}) {
  const { t } = useTranslation();
  const source = sourceState.source;
  const { format, setFormat, dpi, setDpi, quality, setQuality, single, setSingle, transparent, setTransparent, gray, setGray, archive, setArchive, ocr, setOcr, pictures, setPictures, headerFooter, setHeaderFooter, xlsxFormat, setXlsxFormat, borderless, setBorderless, sheets, setSheets, layout, setLayout, split, setSplit, includeImages, setIncludeImages, cover, setCover, bookTitle, setBookTitle, bookAuthor, setBookAuthor, pptxMode, setPptxMode } = options;
  return (
    <>
      <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={running} />
      <Section title={t("tools.convert.options")}>
          <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
            <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="w-64 font-mono" disabled={running} />
          </Field>
        {mode === "images" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tools.convert.imageFormat")}>
              <SelectInput value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)} disabled={running}>
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
                <option value="webp">WebP</option>
                <option value="tiff">TIFF</option>
              </SelectInput>
            </Field>
            <Field label={t("tools.convert.dpi")}>
              <SelectInput value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={running}>
                {[72, 96, 150, 200, 300, 400, 600].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </SelectInput>
            </Field>
            {format === "png" || format === "tiff" ? null : (
              <Field label={`${t("tools.convert.imageQuality")} · %${quality}`} hint={t("tools.convert.imageQualityHint")} className="col-span-2">
                <input
                  type="range"
                  disabled={running}
                  min={10}
                  max={100}
                  value={quality}
                  onChange={(event) => setQuality(Number(event.target.value))}
                  className="w-full accent-primary"
                  aria-label={t("tools.convert.imageQuality")}
                />
              </Field>
            )}
          </div>
        ) : null}
        {mode === "images" ? (
          <>
            <Checkbox
              label={t(format === "tiff" ? "tools.convert.singleTiff" : "tools.convert.singleImage")}
              hint={t(format === "tiff" ? "tools.convert.singleTiffHint" : "tools.convert.singleImageHint")}
              checked={single}
              onChange={setSingle}
              disabled={running}
            />
            {single ? null : <Checkbox label={t("tools.convert.archive")} hint={t("tools.convert.archiveHint")} checked={archive} onChange={setArchive} disabled={running} />}
            <Checkbox label={t("tools.convert.gray")} hint={t("tools.convert.grayHint")} checked={gray} onChange={setGray} disabled={running} />
            {format === "jpg" ? null : (
              <Checkbox label={t("tools.convert.transparent")} hint={t("tools.convert.transparentHint")} checked={transparent} onChange={setTransparent} disabled={running} />
            )}
          </>
        ) : null}
        {mode === "xlsx" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tools.convert.xlsxFormat")}>
              <SelectInput value={xlsxFormat} onChange={(event) => setXlsxFormat(event.target.value as XlsxFormat)} disabled={running}>
                <option value="xlsx">{t("tools.convert.xlsxFormatWorkbook")}</option>
                <option value="csv">{t("tools.convert.xlsxFormatCsv")}</option>
              </SelectInput>
            </Field>
            <Field label={t("tools.convert.xlsxSheets")} hint={xlsxFormat === "csv" ? t("tools.convert.xlsxCsvHint") : undefined}>
              <SelectInput value={sheets} onChange={(event) => setSheets(event.target.value as XlsxSheets)} disabled={running || xlsxFormat === "csv"}>
                <option value="table">{t("tools.convert.xlsxSheetsTable")}</option>
                <option value="page">{t("tools.convert.xlsxSheetsPage")}</option>
                <option value="single">{t("tools.convert.xlsxSheetsSingle")}</option>
              </SelectInput>
            </Field>
            <div className="col-span-2">
              <Checkbox label={t("tools.convert.borderless")} hint={t("tools.convert.borderlessHint")} checked={borderless} onChange={setBorderless} disabled={running} />
            </div>
          </div>
        ) : null}
        {mode === "pptx" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tools.convert.pptxMode")} hint={t(pptxMode === "editable" ? "tools.convert.pptxModeEditableHint" : "tools.convert.pptxModeImageHint")}>
              <SelectInput value={pptxMode} onChange={(event) => setPptxMode(event.target.value as PptxMode)} disabled={running}>
                <option value="editable">{t("tools.convert.pptxModeEditable")}</option>
                <option value="image">{t("tools.convert.pptxModeImage")}</option>
              </SelectInput>
            </Field>
            <Field label={t("tools.convert.dpi")}>
              <SelectInput value={dpi} onChange={(event) => setDpi(Number(event.target.value))} className="w-32" disabled={running}>
                {[96, 150, 200, 300].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}
        {mode === "docx" ? (
          <Checkbox label={t("tools.convert.headerFooter")} hint={t("tools.convert.headerFooterHint")} checked={headerFooter} onChange={setHeaderFooter} disabled={running} />
        ) : null}
        {mode === "text" ? <Checkbox label={t("tools.convert.keepLayout")} checked={layout} onChange={setLayout} disabled={running} /> : null}
        {mode === "markdown" ? (
          <Field label={t("tools.convert.markdownPictures")} hint={t("tools.convert.markdownPicturesHint")}>
            <SelectInput value={pictures} onChange={(event) => setPictures(event.target.value as MarkdownPictures)} className="w-72" disabled={running}>
              <option value="none">{t("tools.convert.markdownPicturesNone")}</option>
              <option value="files">{t("tools.convert.markdownPicturesFiles")}</option>
              <option value="embed">{t("tools.convert.markdownPicturesEmbed")}</option>
            </SelectInput>
          </Field>
        ) : null}
        {READS_TEXT.has(mode) ? (
          <Checkbox
            label={t("tools.convert.ocrFirst")}
            hint={ocrLanguages.length > 0 ? t("tools.convert.ocrFirstHint", { languages: ocrLanguages.join(", ") }) : t("tools.convert.ocrFirstMissing")}
            checked={ocr && ocrLanguages.length > 0}
            onChange={setOcr}
            disabled={running || ocrLanguages.length === 0}
          />
        ) : null}
        {mode === "epub" ? (
          <>
            <Field label={t("tools.convert.epubSplit")} hint={t("tools.convert.epubSplitHint")}>
              <SelectInput value={split} onChange={(event) => setSplit(event.target.value as "auto" | "chapter" | "page")} className="w-72" disabled={running}>
                <option value="auto">{t("tools.convert.epubSplitAuto")}</option>
                <option value="chapter">{t("tools.convert.epubSplitChapter")}</option>
                <option value="page">{t("tools.convert.epubSplitPage")}</option>
              </SelectInput>
            </Field>
            <Checkbox label={t("tools.convert.includeImages")} checked={includeImages} onChange={setIncludeImages} disabled={running} />
            <Checkbox label={t("tools.convert.epubCover")} hint={t("tools.convert.epubCoverHint")} checked={cover} onChange={setCover} disabled={running} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("tools.convert.epubTitle")} hint={t("tools.convert.epubMetadataHint")}>
                <TextInput value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder={source?.info?.metadata.title || stemOf(source?.path ?? "")} disabled={running} />
              </Field>
              <Field label={t("tools.convert.epubAuthor")}>
                <TextInput value={bookAuthor} onChange={(event) => setBookAuthor(event.target.value)} placeholder={source?.info?.metadata.author || undefined} disabled={running} />
              </Field>
            </div>
          </>
        ) : null}
      </Section>
      <Section>
        {mode === "images" || mode === "extract-images" ? (
          <OutputDirField value={outputDir} onChange={setOutputDir} disabled={running} />
        ) : (
          <OutputPathField value={output} onChange={setOutput} disabled={running} extension={outputExtension} />
        )}
      </Section>
    </>
  );
}
