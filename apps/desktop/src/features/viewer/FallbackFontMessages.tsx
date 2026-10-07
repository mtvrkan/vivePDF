import { useRef } from "react";
import { Languages, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { useDocumentStore } from "@/shared/store/documentStore";
import { downloadFontSet } from "@/shared/session/fallbackFonts";
import { useFallbackFontsStore, type FontDownload } from "@/shared/store/fallbackFontsStore";
import { pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { MessageRow } from "./MessageRow";
import { downloadableFontSets, fontSetBytes } from "./pdf/fontFallback";
import { useReloadDocument } from "./useReloadDocument";
import { useUnsavedMarks } from "./useUnsavedMarks";

const NONE: string[] = [];
const SET_BYTES = new Map(downloadableFontSets().map((set) => [set.id, fontSetBytes(set)]));

function percentOf(download: FontDownload | undefined): number | null {
  if (download?.state !== "downloading") return null;
  const received = download.progress?.detail?.received;
  const total = download.progress?.detail?.total;
  return typeof received === "number" && typeof total === "number" && total > 0 ? Math.round((received / total) * 100) : 0;
}

export function FallbackFontMessages({ documentId }: { documentId: string }) {
  const missing = useFallbackFontsStore((state) => state.missing[documentId] ?? NONE);
  const dismissed = useFallbackFontsStore((state) => state.dismissed[documentId] ?? NONE);
  const shown = missing.filter((fontSet) => SET_BYTES.has(fontSet) && !dismissed.includes(fontSet));
  if (shown.length === 0) return null;
  return <FallbackFontRows documentId={documentId} sets={shown} />;
}

function FallbackFontRows({ documentId, sets }: { documentId: string; sets: string[] }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const downloads = useFallbackFontsStore((state) => state.downloads);
  const dismiss = useFallbackFontsStore((state) => state.dismiss);
  const unsavedMarks = useUnsavedMarks(documentId);
  const queued = usePendingChangesStore((state) => pendingChangesFor(state.changes, documentId).length);
  const reload = useReloadDocument(documentId);
  const { provides: historyCapability } = useHistoryCapability();
  const historyRef = useRef(historyCapability);
  historyRef.current = historyCapability;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const unsaved = unsavedMarks || queued > 0;

  const download = async (fontSet: string) => {
    const installed = await downloadFontSet(fontSet);
    if (!installed) return;
    const documents = useDocumentStore.getState();
    const stillOpen = documents.documents[documentId] !== undefined && documents.activeId === documentId;
    const hasMarks = historyRef.current?.forDocument(documentId).canUndo() ?? false;
    const hasQueued = pendingChangesFor(usePendingChangesStore.getState().changes, documentId).length > 0;
    if (stillOpen && !hasMarks && !hasQueued) await reloadRef.current();
  };

  return (
    <>
      {sets.map((fontSet) => {
        const language = t(`settings.fallbackFonts.sets.${fontSet}`);
        const state = downloads[fontSet];
        const percent = percentOf(state);
        return (
          <MessageRow key={fontSet} tone={state?.state === "failed" ? "invalid" : undefined}>
            <Languages className="size-4 shrink-0 text-primary" aria-hidden />
            {state?.state === "installed" ? (
              <span className="min-w-0 flex-1 truncate">{t(unsaved ? "viewer.messages.fonts.readyUnsaved" : "viewer.messages.fonts.ready", { language })}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {t("viewer.messages.fonts.missing", { language, size: formatBytes(SET_BYTES.get(fontSet) ?? 0, locale) })}
              </span>
            )}
            {state?.state === "failed" ? <span className="max-w-64 truncate text-destructive">{describeError(t, state.error)}</span> : null}
            {state?.state === "installed" ? (
              unsaved ? null : (
                <Button size="sm" variant="ghost" onClick={() => void reload()}>
                  {t("viewer.messages.fonts.reload")}
                </Button>
              )
            ) : (
              <Button size="sm" variant="ghost" loading={percent !== null} onClick={() => void download(fontSet)}>
                {percent !== null
                  ? t("viewer.messages.fonts.downloading", { percent })
                  : t(state?.state === "failed" ? "viewer.messages.fonts.retry" : "viewer.messages.fonts.download")}
              </Button>
            )}
            <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={() => dismiss(documentId, fontSet)} />
          </MessageRow>
        );
      })}
    </>
  );
}
