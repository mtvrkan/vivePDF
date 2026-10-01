import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { redactPreview, scanPresets } from "@/shared/rpc/operations";
import { REDACT_PRESETS, type RedactPreset, type SourceDocument, type ToastKind } from "@/types";
import { PRESETS, presetsFromQuery, type Tab } from "./editShared";

export function useRedactState(source: SourceDocument | null, tab: Tab, pages: string, searchParams: URLSearchParams, t: TFunction, toast: (kind: ToastKind, message: string) => void) {
  const [terms, setTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [patterns, setPatterns] = useState("");
  const [presets, setPresets] = useState<RedactPreset[]>(() => presetsFromQuery(searchParams.get("presets")));
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [redactWholeWord, setRedactWholeWord] = useState(false);
  const [imagesMode, setImagesMode] = useState<"none" | "overlapping" | "all">("overlapping");
  const [graphicsMode, setGraphicsMode] = useState<"touched" | "contained">("touched");
  const [redactFill, setRedactFill] = useState("#000000");
  const [overlayText, setOverlayText] = useState("");
  const [redactWholePages, setRedactWholePages] = useState("");
  const [redactScrubHidden, setRedactScrubHidden] = useState(true);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [found, setFound] = useState<Partial<Record<RedactPreset, number>> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedPages, setScannedPages] = useState(0);
  const [scanShortfall, setScanShortfall] = useState<{ scanned: number; total: number } | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  const scan = useCallback(async () => {
    if (!source?.info) return;
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setScanning(true);
    setScanError(null);
    setScanShortfall(null);
    try {
      const result = await scanPresets({ path: source.path, password: source.password ?? undefined }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setFound(result.counts);
      setScannedPages(result.pagesScanned);
      setScanShortfall(result.complete === false ? { scanned: result.pagesScanned, total: result.pagesSelected ?? result.pageCount } : null);
      setPresets((state) => {
        const present = REDACT_PRESETS.filter((item) => (result.counts[item] ?? 0) > 0);
        const kept = state.filter((item) => present.includes(item));
        return kept.length > 0 ? kept : present.filter((item) => item !== "date");
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFound(null);
      setScannedPages(0);
      setScanError(describeError(t, toRpcError(error)));
    } finally {
      if (scanAbort.current === controller) {
        scanAbort.current = null;
        setScanning(false);
      }
    }
  }, [source?.path, source?.password, source?.info, t]);

  useEffect(() => {
    setFound(null);
    setScanError(null);
    setScannedPages(0);
    setScanShortfall(null);
    if (tab === "redact" && source?.info) void scan();
    return () => scanAbort.current?.abort();
  }, [tab, source?.path, source?.info, scan]);

  const addTerm = () => {
    const value = termInput.trim();
    if (value && !terms.includes(value)) setTerms((state) => [...state, value]);
    setTermInput("");
  };

  const presentPresets = found ? PRESETS.filter((item) => (found[item] ?? 0) > 0) : [];
  const patternList = patterns.split("\n").map((item) => item.trim()).filter(Boolean);
  const redactSearchReady = terms.length + patternList.length + presets.length > 0;
  const redactReady = redactSearchReady || redactWholePages.trim().length > 0;

  const preview = async () => {
    if (!source) return;
    setPreviewing(true);
    try {
      const result = await redactPreview({ path: source.path, password: source.password ?? undefined, searchText: terms, patterns: patternList, presets, caseSensitive, wholeWord: redactWholeWord, pages: pages.trim() || undefined });
      setPreviewCount(result.hits.length);
    } catch (error) {
      const rpcError = toRpcError(error);
      toast("error", describeError(t, rpcError));
    } finally {
      setPreviewing(false);
    }
  };

  return {
    terms,
    setTerms,
    termInput,
    setTermInput,
    patterns,
    setPatterns,
    presets,
    setPresets,
    caseSensitive,
    setCaseSensitive,
    redactWholeWord,
    setRedactWholeWord,
    imagesMode,
    setImagesMode,
    graphicsMode,
    setGraphicsMode,
    redactFill,
    setRedactFill,
    overlayText,
    setOverlayText,
    redactWholePages,
    setRedactWholePages,
    redactScrubHidden,
    setRedactScrubHidden,
    previewCount,
    setPreviewCount,
    previewing,
    found,
    scanning,
    scanError,
    scannedPages,
    scanShortfall,
    scan,
    addTerm,
    presentPresets,
    patternList,
    redactSearchReady,
    redactReady,
    preview,
  };
}

export type RedactState = ReturnType<typeof useRedactState>;
