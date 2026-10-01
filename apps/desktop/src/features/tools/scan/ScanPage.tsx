import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpZA, Camera, ChevronDown, ChevronUp, Crop, Printer, RefreshCw, RotateCw, Save, ScanLine, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/app/i18n";
import { defaultOcrLanguages } from "@/app/locales";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, OptionCards, Section, SelectInput, TextArea, TextInput } from "@/components/tool/form";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { formatNumber } from "@/shared/lib/format";
import { defaultOutputDirectory, joinPath, outputDirectoryFor, stemOf, suggestOutputPath } from "@/shared/lib/paths";
import { IconButton } from "@/components/shared/IconButton";
import { basenameOf } from "@/shared/lib/paths";
import { ScanSplitPreview } from "./ScanSplitPreview";
import { ScanEnhancePreview } from "./ScanEnhancePreview";
import { movePhoto, nextRotation, rotationParams, sortPhotosByName, withRotation } from "./photoOrder";
import { acquireFromScanner, assembleScanSession, createSeparatorSheets, discardScanSession, enhanceScan, listScanners, photoToPdf, splitScans } from "@/shared/rpc/operations";
import { useScanProfilesStore, type ScanProfileSettings } from "@/shared/store/scanProfilesStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcCallOptions } from "@/shared/rpc/client";
import type { PhotoRotation, ScanColorMode, ScanEnhanceMode, ScanEnhanceParams, ScanEnhanceResult, ScanPhotoParams, ScanPhotoResult, ScanSplitMode, ScanSplitParams, ScanSplitPart, ScanSplitResult, SeparatorSheetParams, SeparatorSheetResult, ScannerAcquireParams, ScannerAcquireResult, ScannerAssembleParams, ScannerAssembleResult, ScannerDevice } from "@/types";
import { DropZone } from "@/components/tool/DropZone";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { useDropHandler } from "@/shared/hooks/useDropHandler";
import { PHOTO_EXTENSIONS, isPhotoPath } from "./photoFiles";
import { scannerNotice, type ScannerUnsupportedReason } from "./scannerNotice";
import { PhotoCornerEditor } from "./PhotoCornerEditor";
import { ScanSessionPanel } from "./ScanSessionPanel";
import { appendScan, autoScanName, orphanedParts, sessionParts, useScanSessionStore, type SessionPage } from "./scanSession";
import { EMPTY_CORNER_STATE, cornerParams, hasCorners, withPhotoState, type PhotoCornerState } from "./cornerGeometry";

type Tab = "scanner" | "enhance" | "split" | "photo";
const TABS: Tab[] = ["scanner", "enhance", "split", "photo"];
const SCAN_DPI_OPTIONS = [150, 200, 300, 400, 600];
const SCAN_SOURCES: Array<"auto" | "flatbed" | "feeder"> = ["auto", "flatbed", "feeder"];
const PAPERS: Array<"auto" | "a4" | "letter"> = ["auto", "a4", "letter"];
const COLOR_MODES: ScanColorMode[] = ["color", "gray", "bw"];
const ENHANCE_MODES: ScanEnhanceMode[] = ["auto", "color", "gray", "bw"];
const SPLIT_MODES: ScanSplitMode[] = ["blank", "qr", "barcode", "text"];
const DPI_OPTIONS = [150, 200, 300];
const BLANK_RUNS = [1, 2, 3];
const SEPARATOR_PREFIX = "VIVE:";
const DEFAULT_PATTERN: Record<ScanSplitMode, string> = { blank: "{name}-{n}", qr: "{name}-{n}-{label}", barcode: "{name}-{n}-{label}", text: "{name}-{label}" };

type ScanRun =
  | { tab: "enhance"; params: ScanEnhanceParams; overwrite?: boolean }
  | { tab: "split"; params: ScanSplitParams; overwrite?: boolean }
  | { tab: "photo"; params: ScanPhotoParams; overwrite?: boolean }
  | { tab: "scanner"; params: ScannerAcquireParams; overwrite?: boolean }
  | { tab: "scannerSave"; params: ScannerAssembleParams; overwrite?: boolean }
  | { tab: "separator"; params: SeparatorSheetParams; overwrite?: boolean };
type ScanResult = ScanEnhanceResult | ScanSplitResult | ScanPhotoResult | ScannerAcquireResult | ScannerAssembleResult | SeparatorSheetResult;

function runScan(input: ScanRun, options: RpcCallOptions): Promise<ScanResult> {
  const overwrite = input.overwrite ?? input.params.overwrite;
  if (input.tab === "scanner") return acquireFromScanner({ ...input.params, overwrite }, options);
  if (input.tab === "scannerSave") return assembleScanSession({ ...input.params, overwrite }, options);
  if (input.tab === "enhance") return enhanceScan({ ...input.params, overwrite }, options);
  if (input.tab === "photo") return photoToPdf({ ...input.params, overwrite }, options);
  if (input.tab === "separator") return createSeparatorSheets({ ...input.params, overwrite }, options);
  return splitScans({ ...input.params, overwrite }, options);
}

export function ScanPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(runScan);
  const installedOcrLanguages = useToolsStatusStore((state) => state.tools?.ocrLanguages);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const preferredOcrLanguage = usePreferencesStore((state) => state.ocrLanguage);
  const orientationLanguages = useMemo(() => {
    const wanted = [...(preferredOcrLanguage ? [preferredOcrLanguage] : []), ...defaultOcrLanguages(currentLocale())];
    if (!installedOcrLanguages) return [...new Set(wanted)];
    const usable = [...new Set(wanted)].filter((code) => installedOcrLanguages.includes(code));
    if (usable.length > 0) return usable;
    return installedOcrLanguages.includes("eng") ? ["eng"] : installedOcrLanguages.slice(0, 1);
  }, [installedOcrLanguages, preferredOcrLanguage]);

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);
  const [tab] = useTabParam<Tab>(TABS, "enhance");
  const [scanners, setScanners] = useState<ScannerDevice[] | null>(null);
  const [scanningSupported, setScanningSupported] = useState(true);
  const [scanningReason, setScanningReason] = useState<ScannerUnsupportedReason>(null);
  const [scannerId, setScannerId] = useState("");
  const [scanOutput, setScanOutput] = useState("");
  const [scanDpi, setScanDpi] = useState(300);
  const [scanMode, setScanMode] = useState<ScanColorMode>("color");
  const [scanSource, setScanSource] = useState<"auto" | "flatbed" | "feeder">("auto");
  const [scanSheets, setScanSheets] = useState(0);
  const [scanDuplex, setScanDuplex] = useState(false);
  const [scanDeskew, setScanDeskew] = useState(true);
  const [scanWhiten, setScanWhiten] = useState(false);
  const [scanDespeckle, setScanDespeckle] = useState(false);
  const [scanSkipBlank, setScanSkipBlank] = useState(false);
  const [scanOcr, setScanOcr] = useState(false);
  const [scanAutoName, setScanAutoName] = useState(true);
  const [scanFolder, setScanFolder] = useState("");
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState<string | null>(null);
  const [lastScannerAction, setLastScannerAction] = useState<"scan" | "save">("scan");
  const profiles = useScanProfilesStore((state) => state.profiles);
  const saveProfile = useScanProfilesStore((state) => state.save);
  const removeProfile = useScanProfilesStore((state) => state.remove);
  const sessionPages = useScanSessionStore((state) => state.pages);
  const setSessionPages = useScanSessionStore((state) => state.setPages);
  const ocrAvailable = !installedOcrLanguages || installedOcrLanguages.length > 0;

  const [output, setOutput] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [pages, setPages] = useState("");
  const [onlyScanned, setOnlyScanned] = useState(true);
  const [colorMode, setColorMode] = useState<ScanEnhanceMode>("color");
  const [dpi, setDpi] = useState(200);
  const [deskew, setDeskew] = useState(true);
  const [despeckle, setDespeckle] = useState(true);
  const [whiten, setWhiten] = useState(true);
  const [orientation, setOrientation] = useState(false);
  const [removeBlank, setRemoveBlank] = useState(false);
  const [cleanEdges, setCleanEdges] = useState(false);
  const [contrast, setContrast] = useState(1);
  const [splitMode, setSplitMode] = useState<ScanSplitMode>("blank");
  const [pattern, setPattern] = useState(DEFAULT_PATTERN.blank);
  const [dropSeparators, setDropSeparators] = useState(true);
  const [qrPrefix, setQrPrefix] = useState("");
  const [textPattern, setTextPattern] = useState("");
  const [minPages, setMinPages] = useState(1);
  const [blankRun, setBlankRun] = useState(1);
  const [splitParts, setSplitParts] = useState<ScanSplitPart[] | null>(null);
  const [separatorLabels, setSeparatorLabels] = useState("");
  const [lastSplitAction, setLastSplitAction] = useState<"split" | "sheets">("split");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoOutput, setPhotoOutput] = useState("");
  const [photoAutoCrop, setPhotoAutoCrop] = useState(true);
  const [photoWhiten, setPhotoWhiten] = useState(true);
  const [photoMode, setPhotoMode] = useState<ScanEnhanceMode>("color");
  const [photoPaper, setPhotoPaper] = useState<"auto" | "a4" | "letter">("auto");
  const [photoCorners, setPhotoCorners] = useState<Record<string, PhotoCornerState>>({});
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null);
  const [photoRotations, setPhotoRotations] = useState<Record<string, PhotoRotation>>({});

  useEffect(() => {
    if (photos.length > 0 && !photoOutput) setPhotoOutput(suggestOutputPath(photos[0], t("tools.scan.photo.suffix"), "pdf"));
  }, [photos, photoOutput, t]);

  const addPhotoPaths = useCallback((paths: string[]) => {
    const images = paths.filter(isPhotoPath);
    if (images.length === 0) return;
    setPhotos((state) => [...state, ...images.filter((path) => !state.includes(path))]);
  }, []);
  useDropHandler(tab === "photo" ? addPhotoPaths : null);

  const addPhotos = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.scan.photo.images"), extensions: PHOTO_EXTENSIONS }] });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setPhotos((state) => [...state, ...paths.filter((path) => !state.includes(path))]);
  };

  useEffect(() => {
    if (tab !== "scanner" || scanners !== null) return;
    void listScanners()
      .then((found) => {
        setScanningSupported(found.supported);
        setScanningReason(found.reason ?? null);
        setScanners(found.devices);
        setScannerId((current) => current || found.devices[0]?.id || "");
      })
      .catch(() => setScanners([]));
  }, [tab, scanners]);

  useEffect(() => {
    if (tab !== "scanner" || (scanOutput && scanFolder)) return;
    void defaultOutputDirectory().then((directory) => {
      setScanFolder((current) => current || directory);
      setScanOutput((current) => current || joinPath(directory, `${t("tools.scan.scanner.suffix")}.pdf`));
    });
  }, [tab, scanOutput, scanFolder, t]);

  const profileSettings = (): ScanProfileSettings => ({
    source: scanSource,
    dpi: scanDpi,
    mode: scanMode,
    sheets: scanSheets,
    duplex: scanDuplex,
    deskew: scanDeskew,
    despeckle: scanDespeckle,
    whiten: scanWhiten,
    skipBlank: scanSkipBlank,
    ocr: scanOcr,
    autoName: scanAutoName,
  });

  const applyProfile = (id: string) => {
    setProfileId(id);
    const settings = profiles.find((item) => item.id === id)?.settings;
    if (!settings) return;
    setScanSource(settings.source);
    setScanDpi(settings.dpi);
    setScanMode(settings.mode);
    setScanSheets(settings.sheets);
    setScanDuplex(settings.duplex);
    setScanDeskew(settings.deskew);
    setScanDespeckle(settings.despeckle);
    setScanWhiten(settings.whiten);
    setScanSkipBlank(settings.skipBlank);
    setScanOcr(settings.ocr);
    setScanAutoName(settings.autoName);
  };

  const storeProfile = () => {
    if (!profileName?.trim()) return;
    setProfileId(saveProfile(profileName, profileSettings()).id);
    setProfileName(null);
  };

  const changeSession = (next: SessionPage[]) => {
    const orphans = orphanedParts(useScanSessionStore.getState().pages, next);
    setSessionPages(next);
    if (orphans.length > 0) void discardScanSession(orphans).catch(() => undefined);
  };

  const clearSession = () => {
    const parts = sessionParts(useScanSessionStore.getState().pages);
    setSessionPages([]);
    if (parts.length > 0) void discardScanSession(parts).catch(() => undefined);
  };

  const scanTarget = scanAutoName ? (scanFolder ? joinPath(scanFolder, autoScanName(t("tools.scan.scanner.suffix"), new Date())) : "") : scanOutput;

  const source = sourceState.source;
  const notice = scannerNotice(scanners, scanningSupported, scanningReason);

  useEffect(() => {
    if (!source) return;
    setOutput(suggestOutputPath(source.path, t("tools.scan.enhance.suffix")));
    setOutputDir(joinPath(outputDirectoryFor(source.path), `${stemOf(source.path)}-${t("tools.scan.split.suffix")}`));
  }, [source, t]);

  const changeSplitMode = (mode: ScanSplitMode) => {
    setSplitMode(mode);
    if (Object.values(DEFAULT_PATTERN).includes(pattern)) setPattern(DEFAULT_PATTERN[mode]);
  };

  const selectedScanner = scanners?.find((device) => device.id === scannerId) ?? null;
  const ready =
    tab === "scanner"
      ? !!scannerId
      : tab === "photo"
      ? photos.length > 0 && photoOutput.length > 0
      : !!source?.info &&
        (tab === "enhance" ? output.length > 0 : outputDir.length > 0 && pattern.trim().length > 0 && (splitMode !== "text" || textPattern.trim().length > 0));

  const saveReady = tab === "scanner" && sessionPages.length > 0 && scanTarget.length > 0;

  const saveSession = async () => {
    if (!saveReady) return;
    setLastScannerAction("save");
    const saved = await operation.run({
      tab: "scannerSave",
      params: {
        pages: sessionPages.map((item) => ({ path: item.path, page: item.page, rotation: item.rotation })),
        output: scanTarget,
        ocr: scanOcr && ocrAvailable,
        languages: orientationLanguages,
      },
    });
    if (saved) setSessionPages([]);
  };

  const scanIntoSession = async () => {
    setLastScannerAction("scan");
    const scanned = await operation.run(
      {
        tab: "scanner",
        params: {
          deviceId: scannerId,
          output: "",
          session: true,
          source: selectedScanner?.feeder ? scanSource : "auto",
          dpi: scanDpi,
          mode: scanMode,
          sheets: scanSheets,
          duplex: !!selectedScanner?.duplex && scanDuplex,
          deskew: scanDeskew,
          despeckle: scanDespeckle,
          whiten: scanWhiten,
          skipBlank: scanSkipBlank,
        },
      },
      { quiet: true },
    );
    if (scanned && "sheets" in scanned) setSessionPages(appendScan(useScanSessionStore.getState().pages, scanned.output, scanned.pageCount));
  };

  const run = () => {
    if (!ready) return;
    if (tab === "scanner") {
      void scanIntoSession();
      return;
    }
    if (tab === "photo") {
      void operation.run({ tab, params: { images: photos, output: photoOutput, autoCrop: photoAutoCrop, whiten: photoWhiten, mode: photoMode, paper: photoPaper, rotations: rotationParams(photos, photoRotations), ...cornerParams(photos, photoCorners) } });
      return;
    }
    if (!source) return;
    if (tab === "enhance") {
      void operation.run({
        tab,
        params: {
          path: source.path,
          password: source.password ?? undefined,
          output,
          pages: pages.trim() || undefined,
          onlyScanned,
          dpi,
          deskew,
          despeckle,
          whiten,
          contrast,
          mode: colorMode,
          orientation,
          removeBlank,
          cleanEdges,
          languages: orientationLanguages,
          jpegQuality: 82,
        },
      });
      return;
    }
    void operation.run({
      tab,
      params: {
        path: source.path,
        password: source.password ?? undefined,
        outputDir,
        pattern: pattern.trim(),
        mode: splitMode,
        dropSeparators,
        qrPrefix: (splitMode === "qr" || splitMode === "barcode") && qrPrefix.trim() ? qrPrefix.trim() : undefined,
        textPattern: splitMode === "text" ? textPattern : undefined,
        minPages,
        blankRun: splitMode === "blank" ? blankRun : undefined,
        parts: splitParts ?? undefined,
      },
    });
    setLastSplitAction("split");
  };

  const printSeparators = async () => {
    const prefix = qrPrefix.trim() || SEPARATOR_PREFIX;
    if (!qrPrefix.trim()) setQrPrefix(prefix);
    const labels = separatorLabels.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const directory = outputDir || (await defaultOutputDirectory());
    setLastSplitAction("sheets");
    void operation.run({
      tab: "separator",
      params: {
        output: joinPath(directory, `${t("tools.scan.split.sheets.fileName")}.pdf`),
        labels: labels.length > 0 ? labels : [""],
        prefix,
        title: t("tools.scan.split.sheets.pageTitle"),
        hint: t("tools.scan.split.sheets.pageHint"),
      },
    });
  };

  const result = operation.result;
  const enhanceResult = result && "enhancedPages" in result ? result : null;
  const splitResult = result && "outputs" in result ? result : null;
  const photoResult = result && "pages" in result && Array.isArray(result.pages) ? result : null;
  const scannerResult = result && "sheets" in result ? result : null;
  const sheetsResult = result && "separatorSheets" in result ? result : null;
  const sessionResult = result && "ocrPages" in result ? result : null;

  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
  }, [tab, resetOperation]);

  return (
    <ToolLayout
      title={t(`tools.scan.${tab}.title`)}
      icon={ScanLine}
      actions={
        tab === "scanner" && sessionPages.length > 0 ? (
          <>
            <Button icon={<ScanLine className="size-4" aria-hidden />} onClick={run} disabled={!ready || operation.running}>
              {t("tools.scan.scanner.scanMore")}
            </Button>
            <Button variant="primary" icon={<Save className="size-4" aria-hidden />} onClick={() => void saveSession()} loading={operation.running} disabled={!saveReady}>
              {t("tools.scan.scanner.save")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
            {t(`tools.scan.${tab}.run`)}
          </Button>
        )
      }
      form={
        <>
          {tab !== "photo" && tab !== "scanner" ? (
            <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          ) : null}

          {tab === "scanner" ? (
            <>
              <Section title={t("tools.scan.scanner.session.title")}>
                <ScanSessionPanel pages={sessionPages} disabled={operation.running} onChange={changeSession} onClear={clearSession} />
              </Section>
              <Section title={t("tools.scan.scanner.device")}>
                {notice === "loading" ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : notice === "unsupported" ? (
                  <p className="text-sm text-muted-foreground">{t("tools.scan.scanner.unsupported")}</p>
                ) : notice === "saneMissing" ? (
                  <p className="text-sm text-muted-foreground">{t("tools.scan.scanner.saneMissing")}</p>
                ) : notice === "deviceError" ? (
                  <p className="text-sm text-warning" role="status">{t("tools.scan.scanner.deviceError")}</p>
                ) : notice === "none" || scanners === null ? (
                  <p className="text-sm text-warning">{t("tools.scan.scanner.none")}</p>
                ) : (
                  <Field label={t("tools.scan.scanner.device")}>
                    <SelectInput value={scannerId} onChange={(event) => setScannerId(event.target.value)} disabled={operation.running}>
                      {scanners.map((device) => (
                        <option key={device.id} value={device.id}>{device.name}</option>
                      ))}
                    </SelectInput>
                  </Field>
                )}
                <Button icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => setScanners(null)} disabled={operation.running || (!scanningSupported && scanningReason !== "saneMissing")}>
                  {t("tools.scan.scanner.refresh")}
                </Button>
              </Section>
              <Section title={t("tools.convert.options")}>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("tools.scan.scanner.profiles.label")}>
                    <SelectInput value={profileId} onChange={(event) => applyProfile(event.target.value)} disabled={operation.running} className="w-56">
                      <option value="">{t("tools.scan.scanner.profiles.none")}</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.name}</option>
                      ))}
                    </SelectInput>
                  </Field>
                  {profileName === null ? (
                    <Button size="sm" variant="ghost" onClick={() => setProfileName(profiles.find((item) => item.id === profileId)?.name ?? "")} disabled={operation.running}>
                      {t("tools.scan.scanner.profiles.save")}
                    </Button>
                  ) : (
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        storeProfile();
                      }}
                    >
                      <Field label={t("tools.scan.scanner.profiles.name")}>
                        <TextInput value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={60} autoFocus className="w-48" />
                      </Field>
                      <Button size="sm" type="submit" disabled={!profileName.trim()}>{t("tools.scan.scanner.profiles.store")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setProfileName(null)}>{t("common.cancel")}</Button>
                    </form>
                  )}
                  {profileId && profileName === null ? (
                    <IconButton
                      icon={Trash2}
                      label={t("tools.scan.scanner.profiles.delete", { name: profiles.find((item) => item.id === profileId)?.name ?? "" })}
                      disabled={operation.running}
                      onClick={() => {
                        removeProfile(profileId);
                        setProfileId("");
                      }}
                    />
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("tools.scan.scanner.source")}>
                    <SelectInput value={selectedScanner?.feeder ? scanSource : "auto"} onChange={(event) => setScanSource(event.target.value as "auto" | "flatbed" | "feeder")} disabled={operation.running || !selectedScanner?.feeder}>
                      {SCAN_SOURCES.map((value) => (
                        <option key={value} value={value}>{t(`tools.scan.scanner.sources.${value}`)}</option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label={t("tools.scan.scanner.dpi")}>
                    <SelectInput value={scanDpi} onChange={(event) => setScanDpi(Number(event.target.value))} disabled={operation.running}>
                      {SCAN_DPI_OPTIONS.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label={t("tools.scan.scanner.sheets")} hint={t("tools.scan.scanner.sheetsHint")}>
                    <TextInput
                      type="number"
                      min={0}
                      max={200}
                      value={scanSheets}
                      onChange={(event) => setScanSheets(Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
                      className="font-mono"
                      disabled={operation.running}
                    />
                  </Field>
                </div>
                <OptionCards
                  value={scanMode}
                  onChange={setScanMode}
                  ariaLabel={t("tools.scan.enhance.mode")}
                  options={COLOR_MODES.map((value) => ({
                    value,
                    title: t(`tools.scan.enhance.modes.${value}.title`),
                    description: t(`tools.scan.enhance.modes.${value}.description`),
                  }))}
                />
                {selectedScanner?.duplex ? (
                  <Checkbox label={t("tools.scan.scanner.duplex")} checked={scanDuplex} onChange={setScanDuplex} disabled={operation.running} />
                ) : null}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <Checkbox label={t("tools.scan.enhance.deskew")} checked={scanDeskew} onChange={setScanDeskew} disabled={operation.running} />
                  <Checkbox label={t("tools.scan.enhance.despeckle")} hint={t("tools.scan.enhance.despeckleHint")} checked={scanDespeckle} onChange={setScanDespeckle} disabled={operation.running} />
                  <Checkbox label={t("tools.scan.enhance.whiten")} hint={t("tools.scan.enhance.whitenHint")} checked={scanWhiten} onChange={setScanWhiten} disabled={operation.running} />
                  <Checkbox label={t("tools.scan.scanner.skipBlank")} hint={t("tools.scan.scanner.skipBlankHint")} checked={scanSkipBlank} onChange={setScanSkipBlank} disabled={operation.running} />
                </div>
              </Section>
              <Section title={t("tools.scan.scanner.saving")}>
                <Checkbox
                  label={t("tools.scan.scanner.ocr")}
                  hint={ocrAvailable ? t("tools.scan.scanner.ocrHint", { languages: orientationLanguages.join(", ") }) : t("tools.scan.scanner.ocrMissing")}
                  checked={scanOcr && ocrAvailable}
                  onChange={setScanOcr}
                  disabled={operation.running || !ocrAvailable}
                />
                <Checkbox
                  label={t("tools.scan.scanner.autoName")}
                  hint={t("tools.scan.scanner.autoNameHint", { name: autoScanName(t("tools.scan.scanner.suffix"), new Date()) })}
                  checked={scanAutoName}
                  onChange={setScanAutoName}
                  disabled={operation.running}
                />
                {scanAutoName ? (
                  <OutputDirField value={scanFolder} onChange={setScanFolder} disabled={operation.running} />
                ) : (
                  <OutputPathField value={scanOutput} onChange={setScanOutput} disabled={operation.running} />
                )}
              </Section>
            </>
          ) : null}

          {tab === "photo" ? (
            <>
              <Section title={t("tools.scan.photo.title")}>
                <p className="text-sm text-muted-foreground">{t("tools.scan.photo.description")}</p>
                <DropZone label={t("tools.dropZone.images")}>
                {photos.length === 0 ? (
                  <FileDropArea icon={Camera} title={t("tools.dropZone.images")} description={t("tools.scan.photo.empty")} onPick={() => void addPhotos()} disabled={operation.running} />
                ) : (
                  <ul className="rounded-lg border text-sm">
                    {photos.map((path, index) => (
                      <li key={path} className="flex h-row items-center gap-3 border-b px-3 last:border-b-0">
                        <span className="w-6 font-mono text-xs text-muted-foreground">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate" title={path}>{basenameOf(path)}</span>
                        {hasCorners(photoCorners[path]) ? <span className="shrink-0 text-xs text-primary">{t("tools.scan.photo.corners.adjusted")}</span> : null}
                        {photoRotations[path] ? <span className="shrink-0 text-xs text-primary">{t("tools.scan.photo.rotated", { degrees: photoRotations[path] })}</span> : null}
                        <IconButton icon={ChevronUp} label={t("tools.scan.photo.moveUp", { name: basenameOf(path) })} disabled={operation.running || index === 0} onClick={() => setPhotos((state) => movePhoto(state, path, -1))} />
                        <IconButton icon={ChevronDown} label={t("tools.scan.photo.moveDown", { name: basenameOf(path) })} disabled={operation.running || index === photos.length - 1} onClick={() => setPhotos((state) => movePhoto(state, path, 1))} />
                        <IconButton icon={RotateCw} label={t("tools.scan.photo.rotate", { name: basenameOf(path) })} disabled={operation.running} onClick={() => setPhotoRotations((state) => withRotation(state, path, nextRotation(state[path])))} />
                        <IconButton icon={Crop} label={t("tools.scan.photo.corners.edit")} active={editingPhoto === path} disabled={operation.running} onClick={() => setEditingPhoto((current) => (current === path ? null : path))} />
                        <IconButton
                          icon={X}
                          label={t("common.removeNamed", { name: basenameOf(path) })}
                          disabled={operation.running}
                          onClick={() => {
                            setPhotos((state) => state.filter((item) => item !== path));
                            setPhotoCorners((state) => withPhotoState(state, path, null));
                            setPhotoRotations((state) => withRotation(state, path, null));
                            setEditingPhoto((current) => (current === path ? null : current));
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                </DropZone>
                {editingPhoto && photos.includes(editingPhoto) ? (
                  <PhotoCornerEditor
                    path={editingPhoto}
                    key={editingPhoto}
                    state={photoCorners[editingPhoto] ?? EMPTY_CORNER_STATE}
                    disabled={operation.running}
                    onClose={() => setEditingPhoto(null)}
                    onChange={(next) => setPhotoCorners((state) => withPhotoState(state, editingPhoto, next))}
                  />
                ) : null}
                {photos.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<Camera className="size-4" aria-hidden />} onClick={() => void addPhotos()} disabled={operation.running}>
                      {t("tools.scan.photo.add")}
                    </Button>
                    {photos.length > 1 ? (
                      <>
                        <Button size="sm" variant="ghost" icon={<ArrowDownAZ className="size-4" aria-hidden />} onClick={() => setPhotos((state) => sortPhotosByName(state, locale))} disabled={operation.running}>
                          {t("tools.scan.photo.sortName")}
                        </Button>
                        <Button size="sm" variant="ghost" icon={<ArrowUpZA className="size-4" aria-hidden />} onClick={() => setPhotos((state) => sortPhotosByName(state, locale, true))} disabled={operation.running}>
                          {t("tools.scan.photo.sortNameReverse")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <OptionCards
                  value={photoMode}
                  onChange={setPhotoMode}
                  ariaLabel={t("tools.scan.enhance.mode")}
                  disabled={operation.running}
                  options={ENHANCE_MODES.map((value) => ({
                    value,
                    title: t(`tools.scan.enhance.modes.${value}.title`),
                    description: t(`tools.scan.enhance.modes.${value}.description`),
                  }))}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <Checkbox label={t("tools.scan.photo.autoCrop")} hint={t("tools.scan.photo.autoCropHint")} checked={photoAutoCrop} onChange={setPhotoAutoCrop} disabled={operation.running} />
                  <Checkbox label={t("tools.scan.enhance.whiten")} hint={t("tools.scan.enhance.whitenHint")} checked={photoWhiten} onChange={setPhotoWhiten} disabled={operation.running} />
                </div>
                <Field label={t("tools.scan.photo.paper")}>
                  <SelectInput value={photoPaper} onChange={(event) => setPhotoPaper(event.target.value as "auto" | "a4" | "letter")} className="w-48" disabled={operation.running}>
                    {PAPERS.map((value) => (
                      <option key={value} value={value}>
                        {t(`tools.scan.photo.papers.${value}`)}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              </Section>
              <Section>
                <OutputPathField value={photoOutput} onChange={setPhotoOutput} disabled={operation.running} />
              </Section>
            </>
          ) : null}

          {tab === "enhance" ? (
            <fieldset disabled={operation.running} className="contents">
              <Section title={t("tools.scan.enhance.mode")}>
                <OptionCards
                  value={colorMode}
                  onChange={setColorMode}
                  ariaLabel={t("tools.scan.enhance.mode")}
                  options={ENHANCE_MODES.map((value) => ({
                    value,
                    title: t(`tools.scan.enhance.modes.${value}.title`),
                    description: t(`tools.scan.enhance.modes.${value}.description`),
                  }))}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <Checkbox label={t("tools.scan.enhance.deskew")} hint={t("tools.scan.enhance.deskewHint")} checked={deskew} onChange={setDeskew} />
                  <Checkbox label={t("tools.scan.enhance.despeckle")} hint={t("tools.scan.enhance.despeckleHint")} checked={despeckle} onChange={setDespeckle} />
                  <Checkbox label={t("tools.scan.enhance.whiten")} hint={t("tools.scan.enhance.whitenHint")} checked={whiten} onChange={setWhiten} />
                  <Checkbox label={t("tools.scan.enhance.orientation")} hint={t("tools.scan.enhance.orientationHint")} checked={orientation} onChange={setOrientation} />
                  <Checkbox label={t("tools.scan.enhance.cleanEdges")} hint={t("tools.scan.enhance.cleanEdgesHint")} checked={cleanEdges} onChange={setCleanEdges} />
                  <Checkbox label={t("tools.scan.enhance.removeBlank")} hint={t("tools.scan.enhance.removeBlankHint")} checked={removeBlank} onChange={setRemoveBlank} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${t("tools.scan.enhance.contrast")} · ${contrast.toFixed(1)}×`}>
                    <input type="range" min={0.5} max={2} step={0.1} value={contrast} onChange={(event) => setContrast(Number(event.target.value))} className="w-full accent-primary" aria-label={t("tools.scan.enhance.contrast")} />
                  </Field>
                  <Field label={t("tools.scan.enhance.dpi")}>
                    <SelectInput value={String(dpi)} onChange={(event) => setDpi(Number(event.target.value))} className="w-32">
                      {DPI_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value} dpi
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <Checkbox label={t("tools.scan.enhance.onlyScanned")} hint={t("tools.scan.enhance.onlyScannedHint")} checked={onlyScanned} onChange={setOnlyScanned} />
                <Field label={t("tools.scan.enhance.pages")} hint={t("tools.split.rangesHint")}>
                  <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
                </Field>
              </Section>
              {source ? (
                <Section title={t("tools.scan.enhance.preview.title")}>
                  <ScanEnhancePreview
                    key={source.path}
                    settings={{ path: source.path, password: source.password ?? undefined, deskew, despeckle, whiten, contrast, mode: colorMode, cleanEdges }}
                    pageCount={source.info?.pageCount}
                    ready={!!source.info}
                    disabled={operation.running}
                  />
                  {orientation ? <p className="text-xs text-muted-foreground">{t("tools.scan.enhance.preview.noOrientation")}</p> : null}
                </Section>
              ) : null}
              <Section>
                <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
              </Section>
            </fieldset>
          ) : null}

          {tab === "split" ? (
            <fieldset disabled={operation.running} className="contents">
              <Section title={t("tools.scan.split.mode")}>
                <OptionCards
                  value={splitMode}
                  onChange={changeSplitMode}
                  ariaLabel={t("tools.scan.split.mode")}
                  options={SPLIT_MODES.map((value) => ({
                    value,
                    title: t(`tools.scan.split.modes.${value}.title`),
                    description: t(`tools.scan.split.modes.${value}.description`),
                  }))}
                />
                {splitMode === "qr" || splitMode === "barcode" ? (
                  <Field label={t("tools.scan.split.qrPrefix")} hint={t("tools.scan.split.qrPrefixHint")}>
                    <TextInput value={qrPrefix} onChange={(event) => setQrPrefix(event.target.value)} placeholder="VIVE:" className="font-mono" />
                  </Field>
                ) : null}
                {splitMode === "text" ? (
                  <Field label={t("tools.scan.split.textPattern")} hint={t("tools.scan.split.textPatternHint")}>
                    <TextInput value={textPattern} onChange={(event) => setTextPattern(event.target.value)} placeholder="FATURA NO[:\s]*(\S+)" className="font-mono" />
                  </Field>
                ) : (
                  <Checkbox label={t("tools.scan.split.dropSeparators")} checked={dropSeparators} onChange={setDropSeparators} />
                )}
                {splitMode === "blank" ? (
                  <Field label={t("tools.scan.split.blankRun")} hint={t("tools.scan.split.blankRunHint")}>
                    <SelectInput value={String(blankRun)} onChange={(event) => setBlankRun(Number(event.target.value))} className="w-56">
                      {BLANK_RUNS.map((value) => (
                        <option key={value} value={value}>
                          {t("tools.scan.split.blankRuns", { count: value })}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("tools.scan.split.pattern")} hint={t("tools.scan.split.patternHint")}>
                    <TextInput value={pattern} onChange={(event) => setPattern(event.target.value)} className="font-mono" />
                  </Field>
                  <Field label={t("tools.scan.split.minPages")}>
                    <TextInput type="number" min={1} value={minPages} max={500} onChange={(event) => setMinPages(Math.max(1, Math.min(500, Math.floor(Number(event.target.value)) || 1)))} className="w-32 font-mono" />
                  </Field>
                </div>
              </Section>
              {source ? (
                <Section title={t("tools.scan.split.preview.title")}>
                  <ScanSplitPreview
                    rules={{
                      path: source.path,
                      password: source.password ?? undefined,
                      mode: splitMode,
                      dropSeparators,
                      qrPrefix: (splitMode === "qr" || splitMode === "barcode") && qrPrefix.trim() ? qrPrefix.trim() : undefined,
                      textPattern: splitMode === "text" ? textPattern : undefined,
                      minPages,
                      blankRun: splitMode === "blank" ? blankRun : undefined,
                    }}
                    ready={!!source.info && (splitMode !== "text" || textPattern.trim().length > 0)}
                    disabled={operation.running}
                    parts={splitParts}
                    onPartsChange={setSplitParts}
                  />
                </Section>
              ) : null}
              {splitMode === "qr" || splitMode === "barcode" ? (
                <Section title={t("tools.scan.split.sheets.title")}>
                  <p className="text-sm text-muted-foreground">{t("tools.scan.split.sheets.description")}</p>
                  <Field label={t("tools.scan.split.sheets.labels")} hint={t("tools.scan.split.sheets.labelsHint")}>
                    <TextArea value={separatorLabels} onChange={(event) => setSeparatorLabels(event.target.value)} rows={4} className="font-mono" />
                  </Field>
                  <div>
                    <Button icon={<Printer className="size-4" aria-hidden />} onClick={() => void printSeparators()}>
                      {t("tools.scan.split.sheets.create")}
                    </Button>
                  </div>
                </Section>
              ) : null}
              <Section>
                <OutputDirField value={outputDir} onChange={setOutputDir} disabled={operation.running} />
              </Section>
            </fieldset>
          ) : null}
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={
            sessionResult
              ? formatNumber(sessionResult.pageCount, locale)
              : scannerResult
              ? formatNumber(scannerResult.sheets, locale)
              : photoResult
              ? formatNumber(photoResult.pageCount, locale)
              : enhanceResult
                ? formatNumber(enhanceResult.enhancedPages, locale)
                : splitResult
                  ? formatNumber(splitResult.outputs.length, locale)
                  : sheetsResult
                    ? formatNumber(sheetsResult.separatorSheets, locale)
                    : undefined
          }
          caption={
            sessionResult
              ? [t("tools.scan.scanner.session.savedCaption"), sessionResult.ocrPages > 0 ? t("tools.scan.scanner.session.ocrPages", { count: sessionResult.ocrPages }) : null].filter(Boolean).join(" · ")
              : scannerResult
              ? [
                  t("tools.scan.scanner.resultCaption", { device: scannerResult.device }),
                  scannerResult.skippedBlank > 0 ? t("tools.scan.scanner.skippedBlank", { count: scannerResult.skippedBlank }) : null,
                  scannerResult.interrupted ? t(`tools.scan.scanner.interrupted.${scannerResult.interrupted}`) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : photoResult
              ? t("tools.scan.photo.resultCaption", { cropped: photoResult.pages.filter((page) => page.cropped).length })
              : enhanceResult
                ? [
                    t("tools.scan.enhance.resultCaption", { skipped: enhanceResult.skippedPages, deskewed: enhanceResult.deskewedPages }),
                    enhanceResult.rotatedPages > 0 ? t("tools.scan.enhance.rotated", { count: enhanceResult.rotatedPages }) : null,
                    enhanceResult.removedPages > 0 ? t("tools.scan.enhance.removed", { count: enhanceResult.removedPages }) : null,
                    enhanceResult.ocrKeptPages > 0 ? t("tools.scan.enhance.ocrKept", { count: enhanceResult.ocrKeptPages }) : null,
                    enhanceResult.ocrDroppedPages > 0 ? t("tools.scan.enhance.ocrDropped", { count: enhanceResult.ocrDroppedPages }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : splitResult
                  ? `${t("tools.scan.split.documents", { count: splitResult.outputs.length })} · ${t("tools.scan.split.separators", { count: splitResult.separatorPages.length })}`
                  : sheetsResult
                    ? t("tools.scan.split.sheets.resultCaption", { count: sheetsResult.separatorSheets })
                    : undefined
          }
          outputs={sessionResult ? [sessionResult.output] : scannerResult ? [] : photoResult ? [photoResult.output] : enhanceResult ? [enhanceResult.output] : sheetsResult ? [sheetsResult.output] : (splitResult?.outputs.map((part) => part.output) ?? [])}
          idleIcon={ScanLine}
          idleTitle={t("tools.scan.idle.title")}
          idleDescription={t("tools.scan.idle.description")}
          onCancel={operation.cancel}
          onRetry={tab === "scanner" && lastScannerAction === "save" ? () => void saveSession() : tab === "split" && lastSplitAction === "sheets" ? () => void printSeparators() : run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}
