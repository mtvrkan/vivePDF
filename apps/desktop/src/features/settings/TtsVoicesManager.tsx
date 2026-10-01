import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, FolderOpen, Loader2, Play, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { revealPath } from "@/shared/lib/reveal";
import { toRpcError } from "@/shared/rpc/client";
import { ttsSynthesize } from "@/shared/rpc/operations";
import { useReadingStore } from "@/shared/store/readingStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useTtsVoicesStore } from "@/shared/store/ttsVoicesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { localeDisplayName } from "./voiceLocale";
import type { TtsVoice } from "@/types";

const PREVIEW_SAMPLES: Record<string, string> = {
  tr: "Merhaba, bu bir ses önizlemesidir.",
  en: "Hello, this is a voice preview.",
  de: "Hallo, dies ist eine Sprachvorschau.",
  fr: "Bonjour, ceci est un aperçu vocal.",
  es: "Hola, esta es una vista previa de voz.",
  it: "Ciao, questa è un'anteprima vocale.",
  pt: "Olá, esta é uma prévia de voz.",
  ru: "Привет, это предпросмотр голоса.",
  ar: "مرحبًا، هذه معاينة صوتية.",
  zh: "你好，这是语音预览。",
  nl: "Hallo, dit is een stemvoorbeeld.",
  pl: "Cześć, to jest podgląd głosu.",
  uk: "Привіт, це попередній перегляд голосу.",
  cs: "Ahoj, toto je ukázka hlasu.",
  sv: "Hej, det här är en röstförhandsvisning.",
  fi: "Hei, tämä on ääninäyte.",
  da: "Hej, dette er en stemmeprøve.",
  no: "Hei, dette er en stemmeprøve.",
  hu: "Szia, ez egy hangminta.",
  ro: "Bună, aceasta este o previzualizare vocală.",
  el: "Γεια σας, αυτή είναι μια προεπισκόπηση φωνής.",
  ca: "Hola, això és una previsualització de veu.",
  vi: "Xin chào, đây là bản xem trước giọng nói.",
  fa: "سلام، این یک پیش‌نمایش صدا است.",
  hi: "नमस्ते, यह एक आवाज़ पूर्वावलोकन है।",
};
const QUALITIES = ["all", "high", "medium", "low", "x_low"] as const;
type LanguageFilter = "all" | "installed" | string;

function familyOf(voice: TtsVoice): string {
  return voice.language || voice.locale.split("_")[0] || "";
}

function SpeakerSelect({ voice }: { voice: TtsVoice }) {
  const { t } = useTranslation();
  const chosen = useReadingStore((state) => state.voiceSpeakers[voice.id]);
  const voiceSpeakers = useReadingStore((state) => state.voiceSpeakers);
  const update = useReadingStore((state) => state.update);
  const choices = voice.speakerChoices ?? [];
  if (!voice.installed || choices.length < 2) return null;
  const value = choices.some((choice) => choice.id === chosen) ? String(chosen) : String(choices[0].id);
  return (
    <Select
      value={value}
      options={choices.map((choice) => ({ value: String(choice.id), label: choice.name }))}
      onChange={(next) => update({ voiceSpeakers: { ...voiceSpeakers, [voice.id]: Number(next) } })}
      ariaLabel={`${t("settings.tts.speaker")}: ${voice.name}`}
      size="sm"
      className="w-32"
    />
  );
}

function VoiceRow({ voice, working, percent, previewing, busy, onPreview, onDownload, onRemove, onCancel }: {
  voice: TtsVoice;
  working: boolean;
  percent: number;
  previewing: boolean;
  busy: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className={cn("flex h-11 items-center gap-3 border-b text-sm last:border-b-0", voice.installed ? "text-foreground" : "text-foreground/80")}>
      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", voice.installed ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {working ? <Loader2 className="size-3 animate-spin" aria-hidden /> : voice.installed ? <Check className="size-3" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate" title={voice.id}>
        {voice.name}
      </span>
      {voice.source === "custom" ? <span className="glass-chip rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">{t("settings.tts.custom")}</span> : null}
      {(voice.speakers ?? 1) > 1 && !voice.installed ? <span className="font-mono text-[11px] text-muted-foreground">{t("settings.tts.speakers", { count: voice.speakers })}</span> : null}
      <SpeakerSelect voice={voice} />
      <span className="rounded-md border bg-background/60 px-1.5 font-mono text-[11px] text-muted-foreground">{voice.locale || voice.language}</span>
      <span className="w-14 text-end font-mono text-[11px] text-muted-foreground">{voice.quality}</span>
      {working ? (
        <span
          className="h-1 w-16 shrink-0 overflow-hidden rounded-sm bg-muted"
          role="progressbar"
          aria-label={t("settings.tts.progressLabel", { name: voice.name })}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="block h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${Math.max(percent, 4)}%` }} />
        </span>
      ) : null}
      <span className="w-14 text-end font-mono text-xs tabular-nums text-muted-foreground">{working ? `${percent}%` : `${voice.sizeMb} MB`}</span>
      <span className="flex w-16 items-center justify-end gap-1">
        {voice.installed ? (
          previewing ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <IconButton icon={Play} label={`${t("settings.tts.preview")}: ${voice.name}`} onClick={onPreview} disabled={busy} />
          )
        ) : null}
        {working ? (
          <IconButton icon={X} label={`${t("settings.tts.cancelDownload")}: ${voice.name}`} onClick={onCancel} />
        ) : voice.installed ? (
          <IconButton icon={Trash2} label={`${t("settings.tts.remove")}: ${voice.name}`} onClick={onRemove} disabled={busy} />
        ) : (
          <IconButton icon={ArrowDownToLine} label={`${t("settings.tts.download")}: ${voice.name}`} onClick={onDownload} disabled={busy} />
        )}
      </span>
    </li>
  );
}

export function TtsVoicesManager() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const voices = useTtsVoicesStore((state) => state.voices);
  const directory = useTtsVoicesStore((state) => state.directory);
  const loading = useTtsVoicesStore((state) => state.loading);
  const loaded = useTtsVoicesStore((state) => state.loaded);
  const error = useTtsVoicesStore((state) => state.error);
  const downloadingId = useTtsVoicesStore((state) => state.downloadingId);
  const downloadProgress = useTtsVoicesStore((state) => state.downloadProgress);
  const refresh = useTtsVoicesStore((state) => state.refresh);
  const downloadVoice = useTtsVoicesStore((state) => state.downloadVoice);
  const cancelDownload = useTtsVoicesStore((state) => state.cancelDownload);
  const removeVoice = useTtsVoicesStore((state) => state.removeVoice);
  const importVoice = useTtsVoicesStore((state) => state.importVoice);
  const voiceSpeakers = useReadingStore((state) => state.voiceSpeakers);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!loaded && !loading) void refresh();
  }, [loaded, loading, refresh]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const download = async (id: string) => {
    try {
      await downloadVoice(id);
      toast("success", t("settings.tts.downloaded"));
    } catch (caught) {
      const rpcError = toRpcError(caught);
      if (rpcError.code === "CANCELLED") toast("info", t("settings.tts.downloadCancelled"));
      else toast("error", describeError(t, rpcError));
    }
  };

  const remove = async (id: string) => {
    try {
      await removeVoice(id);
      toast("success", t("settings.tts.removed"));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    }
  };

  const preview = async (voice: TtsVoice) => {
    setPreviewingId(voice.id);
    try {
      const sample = PREVIEW_SAMPLES[familyOf(voice)] ?? PREVIEW_SAMPLES.en;
      const speakerId = (voice.speakerChoices ?? []).length > 1 ? voiceSpeakers[voice.id] : undefined;
      const result = await ttsSynthesize({ voiceId: voice.id, text: sample, rate: 1, speakerId });
      const audio = new Audio(`data:audio/wav;base64,${result.wavBase64}`);
      audioRef.current = audio;
      audio.onended = () => setPreviewingId(null);
      audio.onerror = () => setPreviewingId(null);
      await audio.play();
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)) || t("settings.tts.previewFailed"));
      setPreviewingId(null);
    }
  };

  const pickAndImport = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "Piper voice", extensions: ["onnx"] }] });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      const id = await importVoice(selected);
      toast("success", t("settings.tts.imported", { id }));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setImporting(false);
    }
  };

  const currentFamily = locale.split("-")[0];
  const families = useMemo(() => {
    const codes = Array.from(new Set(voices.map(familyOf).filter(Boolean)));
    return codes
      .map((code) => ({ code, name: localeDisplayName(code, locale), count: voices.filter((voice) => familyOf(voice) === code).length }))
      .sort((a, b) => Number(b.code === currentFamily) - Number(a.code === currentFamily) || a.name.localeCompare(b.name, locale));
  }, [voices, locale, currentFamily]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return voices.filter((voice) => {
      if (languageFilter === "installed" && !voice.installed) return false;
      if (languageFilter !== "all" && languageFilter !== "installed" && familyOf(voice) !== languageFilter) return false;
      if (quality !== "all" && voice.quality !== quality) return false;
      if (!needle) return true;
      const haystack = `${voice.name} ${voice.id} ${voice.locale} ${localeDisplayName(familyOf(voice), locale)}`.toLocaleLowerCase(locale);
      return haystack.includes(needle);
    });
  }, [voices, query, languageFilter, quality, locale]);

  const groups = useMemo(
    () =>
      families
        .map((family) => ({
          ...family,
          voices: filtered
            .filter((voice) => familyOf(voice) === family.code)
            .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name, locale) || a.quality.localeCompare(b.quality)),
        }))
        .filter((group) => group.voices.length > 0),
    [families, filtered, locale],
  );

  const installedCount = voices.filter((voice) => voice.installed).length;
  const percent = downloadProgress ? Math.round(downloadProgress.progress * 100) : 0;
  const busy = downloadingId !== null || previewingId !== null || importing;
  const chip = (active: boolean) =>
    cn(
      "h-7 shrink-0 rounded-full border px-3 text-xs transition-colors duration-(--transition-fast)",
      active ? "glass-chip border-transparent font-medium text-foreground" : "border-(--glass-border) text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{t("settings.tts.description")}</span>
        <span className="font-mono text-xs text-muted-foreground">{t("settings.tts.installed", { count: installedCount })}</span>
        <Button size="sm" icon={<Upload className="size-4" aria-hidden />} onClick={() => void pickAndImport()} loading={importing} disabled={downloadingId !== null}>
          {t("settings.tts.import")}
        </Button>
        <IconButton icon={FolderOpen} label={t("settings.tts.openFolder")} onClick={() => directory && void revealPath(directory)} disabled={!directory} />
        <IconButton icon={RefreshCw} label={t("settings.tts.refresh")} onClick={() => void refresh()} disabled={loading} />
      </div>
      <p className="text-xs text-muted-foreground">{t("settings.tts.importHint")}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="sticky top-0 z-10 space-y-2 rounded-xl bg-card/80 py-1 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.tts.search")} aria-label={t("settings.tts.search")} className="h-9 ps-9 text-sm" />
          </span>
          <Select
            value={quality}
            options={QUALITIES.map((item) => ({ value: item, label: item === "all" ? t("settings.tts.qualityAll") : item }))}
            onChange={(value) => setQuality(value as (typeof QUALITIES)[number])}
            ariaLabel={t("settings.tts.quality")}
            size="sm"
            className="w-32"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" className={chip(languageFilter === "all")} onClick={() => setLanguageFilter("all")}>
            {t("settings.tts.filterAll")} · {voices.length}
          </button>
          <button type="button" className={chip(languageFilter === "installed")} onClick={() => setLanguageFilter("installed")}>
            {t("settings.tts.filterInstalled")} · {installedCount}
          </button>
          {families.map((family) => (
            <button key={family.code} type="button" className={chip(languageFilter === family.code)} onClick={() => setLanguageFilter(family.code)} title={family.code}>
              {family.name} · {family.count}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-96 overflow-auto pe-1">
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{loading ? t("common.loading") : t("settings.tts.noMatch")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.code} className="mb-3">
              <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.name}
                <span className="font-mono normal-case tracking-normal">{group.voices.length}</span>
              </p>
              <ul>
                {group.voices.map((voice) => (
                  <VoiceRow
                    key={voice.id}
                    voice={voice}
                    working={downloadingId === voice.id}
                    percent={percent}
                    previewing={previewingId === voice.id}
                    busy={busy}
                    onPreview={() => void preview(voice)}
                    onDownload={() => void download(voice.id)}
                    onRemove={() => void remove(voice.id)}
                    onCancel={cancelDownload}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      {directory ? (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={directory}>
          {directory}
        </p>
      ) : null}
    </div>
  );
}
