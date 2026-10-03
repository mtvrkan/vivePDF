import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowDownToLine, Pause, Play, Settings2, SkipBack, SkipForward, Square, Volume2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { describeError } from "@/shared/lib/errorMessage";
import { locateSentences, splitSentences } from "@/shared/lib/sentences";
import { toRpcError } from "@/shared/rpc/client";
import { getPageText, ttsSynthesize } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useReadingStore } from "@/shared/store/readingStore";
import { NEURAL_PREFIX, speechFailureKey, useSpeechStore } from "@/shared/store/speechStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useTtsVoicesStore } from "@/shared/store/ttsVoicesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerPanelsStore } from "@/shared/store/viewerPanelsStore";
import { localeGroupOrder, localeName } from "@/app/locales";

type Status = "idle" | "loading" | "playing" | "paused";
type Chunk = { text: string; start: number; end: number; audio?: string };
const DOWNLOAD_PREFIX = "download:";

export function ReadAloudBar({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const isReading = useViewerPanelsStore((state) => state.panels.reading);
  const rate = useReadingStore((state) => state.rate);
  const voiceUri = useReadingStore((state) => state.voiceUri);
  const voiceSpeakers = useReadingStore((state) => state.voiceSpeakers);
  const update = useReadingStore((state) => state.update);
  const setActiveSentence = useReadingStore((state) => state.setActiveSentence);
  const requestPageScroll = useReadingStore((state) => state.requestPageScroll);
  const neuralVoices = useTtsVoicesStore((state) => state.voices);
  const downloadingId = useTtsVoicesStore((state) => state.downloadingId);
  const downloadProgress = useTtsVoicesStore((state) => state.downloadProgress);
  const refreshVoices = useTtsVoicesStore((state) => state.refresh);
  const volume = useSpeechStore((state) => state.volume);
  const setVolume = useSpeechStore((state) => state.setVolume);
  const speakSpeech = useSpeechStore((state) => state.speak);
  const releaseSpeech = useSpeechStore((state) => state.release);
  const pauseSpeech = useSpeechStore((state) => state.pause);
  const resumeSpeech = useSpeechStore((state) => state.resume);
  const downloadVoice = useTtsVoicesStore((state) => state.downloadVoice);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const [status, setStatus] = useState<Status>("idle");
  const [page, setPage] = useState(scrollState.currentPage);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<number, string>());
  const statusRef = useRef<Status>("idle");
  const requestRef = useRef(0);
  const chunksStateRef = useRef<{ page: number; chunks: Chunk[] } | null>(null);
  const speakPageRef = useRef<(target: number) => void>(() => undefined);
  statusRef.current = status;

  useEffect(() => {
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    void refreshVoices();
    return () => {
      synth.removeEventListener("voiceschanged", refresh);
      useSpeechStore.getState().release();
      audioRef.current?.pause();
      audioRef.current = null;
      setActiveSentence(null);
    };
  }, [refreshVoices, setActiveSentence]);

  const neuralId = voiceUri?.startsWith(NEURAL_PREFIX) ? voiceUri.slice(NEURAL_PREFIX.length) : null;
  const neuralEntry = neuralId ? (neuralVoices.find((voice) => voice.id === neuralId) ?? null) : null;
  const neuralActive = neuralId !== null && neuralEntry?.installed === true;
  const neuralMissing = neuralId !== null && neuralEntry !== null && neuralEntry.installed === false;
  const neuralSpeaker = neuralId !== null && (neuralEntry?.speakerChoices ?? []).length > 1 ? voiceSpeakers[neuralId] : undefined;

  const stop = useCallback(() => {
    requestRef.current += 1;
    releaseSpeech();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setChunks([]);
    setChunkIndex(0);
    chunksStateRef.current = null;
    setActiveSentence(null);
    setStatus("idle");
  }, [setActiveSentence, releaseSpeech]);

  const playChunk = useCallback(
    (target: number, chunkList: Chunk[], index: number, request: number) => {
      if (requestRef.current !== request) return;
      if (index >= chunkList.length) {
        speakPageRef.current(target + 1);
        return;
      }
      setChunkIndex(index);
      setActiveSentence({ page: target, index, start: chunkList[index].start, end: chunkList[index].end });
      const chunk = chunkList[index];
      const advance = () => {
        if (requestRef.current === request) playChunk(target, chunkList, index + 1, request);
      };
      if (chunk.audio) {
        releaseSpeech();
        const audio = new Audio(`data:audio/wav;base64,${chunk.audio}`);
        audioRef.current = audio;
        audio.volume = volume;
        audio.onended = () => {
          if (audioRef.current === audio) advance();
        };
        audio.onerror = () => {
          if (audioRef.current === audio) {
            toast("error", t("viewer.readAloud.failed"));
            setStatus("idle");
          }
        };
        setStatus("playing");
        void audio.play();
        return;
      }
      releaseSpeech();
      const started = speakSpeech(chunk.text, {
        lang: locale,
        rate,
        volume,
        voiceUri,
        owner: "page",
        onEnd: advance,
        onVoiceFallback: (voice) => toast("info", t("viewer.readAloud.otherVoice", { voice: voice.name })),
        onError: (event) => {
          const failure = speechFailureKey(event.error);
          if (failure) toast("error", t(failure));
          if (requestRef.current === request) setStatus("idle");
        },
        onInterrupt: () => {
          if (requestRef.current !== request) return;
          requestRef.current += 1;
          setActiveSentence(null);
          setStatus("idle");
        },
      });
      if (!started) {
        setStatus("idle");
        return;
      }
      setStatus("playing");
    },
    [voiceUri, locale, rate, volume, toast, t, setActiveSentence, speakSpeech, releaseSpeech],
  );

  const speakPage = useCallback(
    async (target: number, from: "first" | "last" = "first") => {
      if (!document) return;
      const total = scrollState.totalPages;
      if (target < 1 || (total > 0 && target > total)) {
        stop();
        return;
      }
      const request = requestRef.current + 1;
      requestRef.current = request;
      setPage(target);
      if (isReading) requestPageScroll(target);
      else scroll?.scrollToPage({ pageNumber: target });
      setStatus("loading");
      let text = cache.current.get(target);
      if (text === undefined) {
        try {
          const result = await getPageText({ path: document.path, password: document.password ?? undefined, pages: String(target) });
          text = result.pages[0]?.text ?? "";
          cache.current.set(target, text);
        } catch (caught) {
          toast("error", describeError(t, toRpcError(caught)));
          setStatus("idle");
          return;
        }
      }
      if (statusRef.current === "idle" || requestRef.current !== request) return;
      const spoken = text.replace(/\s+/g, " ").trim();
      const onward = () => void (from === "last" ? speakPage(target - 1, "last") : speakPage(target + 1));
      if (!spoken) {
        onward();
        return;
      }
      if (neuralActive && neuralId) {
        try {
          const result = await ttsSynthesize({ voiceId: neuralId, text: spoken, rate, sentences: true, speakerId: neuralSpeaker });
          if (requestRef.current !== request) return;
          const nextChunks: Chunk[] = result.chunks.map((chunk) => ({ text: chunk.text, start: chunk.start, end: chunk.end, audio: chunk.wavBase64 }));
          chunksStateRef.current = { page: target, chunks: nextChunks };
          setChunks(nextChunks);
          if (nextChunks.length === 0) {
            onward();
            return;
          }
          playChunk(target, nextChunks, from === "last" ? nextChunks.length - 1 : 0, request);
        } catch (caught) {
          if (requestRef.current !== request) return;
          toast("error", describeError(t, toRpcError(caught)));
          setStatus("idle");
        }
        return;
      }
      const sentences = splitSentences(spoken);
      const located = locateSentences(spoken, sentences);
      const nextChunks: Chunk[] = located.map((entry) => ({ text: entry.text, start: entry.start, end: entry.end }));
      chunksStateRef.current = { page: target, chunks: nextChunks };
      setChunks(nextChunks);
      if (nextChunks.length === 0) {
        onward();
        return;
      }
      playChunk(target, nextChunks, from === "last" ? nextChunks.length - 1 : 0, request);
    },
    [document, scrollState.totalPages, scroll, isReading, requestPageScroll, toast, t, stop, neuralActive, neuralId, neuralSpeaker, rate, playChunk],
  );
  speakPageRef.current = (target) => void speakPage(target);

  const play = () => {
    if (status === "paused") {
      if (audioRef.current) void audioRef.current.play();
      else resumeSpeech();
      setStatus("playing");
      return;
    }
    setStatus("loading");
    void speakPage(status === "idle" ? scrollState.currentPage : page);
  };

  const pause = () => {
    if (audioRef.current) audioRef.current.pause();
    else pauseSpeech();
    setStatus("paused");
  };

  const skip = (delta: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setStatus("loading");
    void speakPage(page + delta);
  };

  const jumpSentence = (delta: number) => {
    const current = chunksStateRef.current;
    if (!current) return;
    const nextIndex = chunkIndex + delta;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    releaseSpeech();
    if (nextIndex < 0 || nextIndex >= current.chunks.length) {
      const target = current.page + (nextIndex < 0 ? -1 : 1);
      if (target < 1 || (scrollState.totalPages > 0 && target > scrollState.totalPages)) return;
      setStatus("loading");
      void speakPage(target, nextIndex < 0 ? "last" : "first");
      return;
    }
    playChunk(current.page, current.chunks, nextIndex, requestRef.current);
  };

  const download = async (id: string) => {
    try {
      await downloadVoice(id);
      update({ voiceUri: `${NEURAL_PREFIX}${id}` });
      toast("success", t("settings.tts.downloaded"));
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    }
  };

  const changeVolume = (value: number) => {
    setVolume(value);
    if (audioRef.current) audioRef.current.volume = value;
  };

  const groupOrder = localeGroupOrder(locale);
  const byLocaleThenName = (localeA: string, localeB: string, nameA: string, nameB: string) =>
    groupOrder(localeA) - groupOrder(localeB) || localeName(localeA).localeCompare(localeName(localeB)) || nameA.localeCompare(nameB);
  const installedNeural = [...neuralVoices].filter((voice) => voice.installed).sort((a, b) => byLocaleThenName(a.locale, b.locale, a.name, b.name));
  const systemSorted = [...voices].sort((a, b) => byLocaleThenName(a.lang, b.lang, a.name, b.name));
  const neuralOptions = installedNeural.map((voice) => ({ value: `${NEURAL_PREFIX}${voice.id}`, label: `${t("viewer.readAloud.groupNeural")} · ${localeName(voice.locale)} · ${voice.name}` }));
  const systemOptions = systemSorted.map((voice) => ({ value: voice.voiceURI, label: `${t("viewer.readAloud.groupSystem")} · ${localeName(voice.lang)} · ${voice.name}` }));
  const voiceOptions = [{ value: "", label: t("viewer.readAloud.autoVoice") }, ...neuralOptions, ...systemOptions];
  const settingsHref = `/settings?section=reading&from=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  const activeChunk = chunks[chunkIndex];
  const percent = downloadProgress ? Math.round(downloadProgress.progress * 100) : 0;

  return (
    <div className="relative z-40 glass-flat border-b text-sm">
      <div className="flex h-11 items-center gap-2 px-3">
        <IconButton icon={SkipBack} label={t("viewer.previousPage")} disabled={page <= 1} onClick={() => skip(-1)} />
        {status === "playing" ? (
          <IconButton icon={Pause} label={t("viewer.readAloud.pause")} onClick={pause} />
        ) : (
          <IconButton icon={Play} label={t("viewer.readAloud.play")} disabled={status === "loading"} onClick={play} />
        )}
        <IconButton icon={Square} label={t("viewer.readAloud.stop")} disabled={status === "idle"} onClick={stop} />
        <IconButton icon={SkipForward} label={t("viewer.nextPage")} disabled={scrollState.totalPages > 0 && page >= scrollState.totalPages} onClick={() => skip(1)} />
        {chunks.length > 0 ? (
          <>
            <IconButton icon={SkipBack} label={t("viewer.readAloud.previousSentence")} disabled={status === "loading" || (chunkIndex <= 0 && page <= 1)} onClick={() => jumpSentence(-1)} />
            <IconButton icon={SkipForward} label={t("viewer.readAloud.nextSentence")} disabled={status === "loading" || (chunkIndex >= chunks.length - 1 && scrollState.totalPages > 0 && page >= scrollState.totalPages)} onClick={() => jumpSentence(1)} />
          </>
        ) : null}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {status === "idle" ? t("viewer.readAloud.idle") : status === "loading" && neuralActive ? t("viewer.readAloud.synthesizing") : t("viewer.readAloud.page", { page, total: scrollState.totalPages })}
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <Select
          value={voiceUri ?? ""}
          options={voiceOptions}
          disabled={downloadingId !== null}
          onChange={(value) => {
            if (value.startsWith(DOWNLOAD_PREFIX)) {
              void download(value.slice(DOWNLOAD_PREFIX.length));
              return;
            }
            stop();
            update({ voiceUri: value || null });
          }}
          ariaLabel={t("viewer.readAloud.voice")}
          className="w-72"
        />
        {downloadingId ? <span className="font-mono text-xs text-muted-foreground">{t("viewer.readAloud.downloading", { percent })}</span> : null}
        <Link to={settingsHref} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" title={t("viewer.readAloud.manageVoices")}>
          <Settings2 className="size-3.5" aria-hidden />
          {t("viewer.readAloud.manageVoices")}
        </Link>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Volume2 className="size-3.5" aria-hidden />
          {Math.round(volume * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            onChange={(event) => changeVolume(Number(event.target.value) / 100)}
            className="w-24 accent-primary"
            aria-label={t("viewer.readAloud.volume")}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("viewer.readAloud.rate")} · {rate.toFixed(1)}×
          <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(event) => update({ rate: Number(event.target.value) })} className="w-28 accent-primary" aria-label={t("viewer.readAloud.rate")} />
        </label>
        {voices.length === 0 && neuralVoices.every((voice) => !voice.installed) ? <span className="text-xs text-warning">{t("viewer.readAloud.noVoices")}</span> : null}
        <span className="flex-1" />
        <IconButton
          icon={X}
          label={t("common.close")}
          onClick={() => {
            stop();
            onClose();
          }}
        />
      </div>
      {neuralMissing ? (
        <div className="flex h-8 items-center gap-2 border-t px-3 text-xs text-warning">
          <span>{t("viewer.readAloud.missingVoice")}</span>
          <button type="button" className="inline-flex items-center gap-1 font-medium underline" onClick={() => neuralId && void download(neuralId)}>
            <ArrowDownToLine className="size-3" aria-hidden />
            {t("viewer.readAloud.download")}
          </button>
        </div>
      ) : null}
      {activeChunk && (status === "playing" || status === "paused") ? (
        <div title={activeChunk.text} className="truncate border-t px-3 py-1.5 text-xs text-muted-foreground">{activeChunk.text}</div>
      ) : null}
    </div>
  );
}
