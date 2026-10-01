import { RefreshCw, ScanSearch, Search, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { formatNumber } from "@/shared/lib/format";
import type { Locale, SourceDocument } from "@/types";
import type { RedactState } from "./useRedactState";

export function RedactTab({ state, source, locale, pages, onPagesChange: setPages }: { state: RedactState; source: SourceDocument | null; locale: Locale; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { terms, setTerms, termInput, setTermInput, patterns, setPatterns, presets, setPresets, caseSensitive, setCaseSensitive, redactWholeWord, setRedactWholeWord, imagesMode, setImagesMode, graphicsMode, setGraphicsMode, redactFill, setRedactFill, overlayText, setOverlayText, redactWholePages, setRedactWholePages, redactScrubHidden, setRedactScrubHidden, previewCount, previewing, found, scanning, scanError, scannedPages, scanShortfall, scan, addTerm, presentPresets, redactSearchReady, preview } = state;
  return (
    <Section title={t("tools.edit.redact.title")}>
      <p className="text-xs text-muted-foreground">{t("tools.edit.redact.hint")}</p>
      <Field label={t("tools.edit.redact.terms")}>
        <div className="flex gap-2">
          <TextInput
            value={termInput}
            onChange={(event) => setTermInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTerm();
              }
            }}
            placeholder={t("tools.edit.redact.termPlaceholder")}
          />
          <Button onClick={addTerm} disabled={!termInput.trim()}>{t("tools.pages.insert")}</Button>
        </div>
      </Field>
      {terms.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {terms.map((term) => (
            <li key={term} className="flex h-7 items-center gap-1 rounded-md border bg-secondary px-2 text-sm">
              <span className="font-mono text-xs">{term}</span>
              <IconButton icon={X} label={t("common.removeNamed", { name: term })} onClick={() => setTerms((state) => state.filter((item) => item !== term))} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-xl border">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <ScanSearch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-medium">{t("tools.edit.redact.foundTitle")}</p>
          {scannedPages > 0 && !scanning ? <p className="shrink-0 text-xs text-muted-foreground">{t("tools.security.removeWatermark.finder.scanned", { count: scannedPages })}</p> : null}
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => void scan()} disabled={scanning || !source?.info} aria-label={t("tools.security.removeWatermark.finder.rescan")} />
        </div>
        {scanning ? <p className="px-3 py-3 text-sm text-muted-foreground">{t("tools.edit.redact.scanning")}</p> : null}
        {!scanning && scanError ? <p className="px-3 py-3 text-sm text-destructive">{scanError}</p> : null}
        {!scanning && !scanError && scanShortfall ? <p className="px-3 pt-2 text-xs text-muted-foreground">{t("tools.edit.redact.scanPartial", scanShortfall)}</p> : null}
        {!scanning && !scanError && found !== null && presentPresets.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">{t("tools.edit.redact.foundNone")}</p> : null}
        {!scanning && !scanError && presentPresets.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-4 px-3 py-2">
            {presentPresets.map((item) => (
              <Checkbox
                key={item}
                label={`${t(`tools.edit.redact.presets.${item}`)} · ${formatNumber(found?.[item] ?? 0, locale)}`}
                checked={presets.includes(item)}
                onChange={(checked) => setPresets((state) => (checked ? [...state, item] : state.filter((entry) => entry !== item)))}
              />
            ))}
          </div>
        ) : null}
      </div>
      <Field label={t("tools.edit.redact.patterns")} hint={t("tools.edit.redact.patternsHint")}>
        <textarea value={patterns} onChange={(event) => setPatterns(event.target.value)} rows={2} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("tools.edit.redact.overlayText")} hint={t("tools.edit.redact.overlayHint")}>
          <TextInput value={overlayText} onChange={(event) => setOverlayText(event.target.value)} maxLength={40} placeholder={t("tools.edit.redact.overlayPlaceholder")} />
        </Field>
        <Field label={t("tools.edit.redact.fill")}>
          <ColorSwatch value={redactFill} onChange={setRedactFill} label={t("tools.edit.redact.fill")} customLabel={t("colorPicker.custom")} presets={["#000000", "#FFFFFF", "#1F3A93", "#7F1D1D", "#374151"]} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("tools.edit.redact.images")}>
          <SelectInput value={imagesMode} onChange={(event) => setImagesMode(event.target.value as "none" | "overlapping" | "all")}>
            <option value="overlapping">{t("tools.edit.redact.imagesOverlapping")}</option>
            <option value="none">{t("tools.edit.redact.imagesNone")}</option>
            <option value="all">{t("tools.edit.redact.imagesAll")}</option>
          </SelectInput>
        </Field>
        <Field label={t("tools.edit.redact.graphics")}>
          <SelectInput value={graphicsMode} onChange={(event) => setGraphicsMode(event.target.value as "touched" | "contained")}>
            <option value="touched">{t("tools.edit.redact.graphicsTouched")}</option>
            <option value="contained">{t("tools.edit.redact.graphicsContained")}</option>
          </SelectInput>
        </Field>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pb-1">
          <Checkbox label={t("tools.edit.redact.caseSensitive")} checked={caseSensitive} onChange={setCaseSensitive} />
          <Checkbox label={t("tools.edit.redact.wholeWord")} checked={redactWholeWord} onChange={setRedactWholeWord} />
        </div>
      </div>
      {imagesMode === "none" ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("tools.edit.redact.imagesNoneWarning")}
        </p>
      ) : null}
      {graphicsMode === "contained" ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {t("tools.edit.redact.graphicsWarning")}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button icon={<Search className="size-4" aria-hidden />} onClick={() => void preview()} loading={previewing} disabled={!source?.info || !redactSearchReady}>
          {t("tools.edit.redact.preview")}
        </Button>
        {previewCount !== null ? <span className="font-mono text-sm">{t("tools.edit.redact.previewCount", { count: previewCount })}</span> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
        <Field label={t("tools.edit.redact.wholePages")} hint={t("tools.edit.redact.wholePagesHint")}>
          <TextInput value={redactWholePages} onChange={(event) => setRedactWholePages(event.target.value)} placeholder={t("tools.edit.redact.wholePagesPlaceholder")} className="font-mono" />
        </Field>
      </div>
      <SwitchField label={t("tools.edit.redact.scrubHidden")} hint={t("tools.edit.redact.scrubHiddenHint")} checked={redactScrubHidden} onChange={setRedactScrubHidden} />
    </Section>
  );
}
