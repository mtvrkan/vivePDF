import { create } from "zustand";
import { splitSentences } from "@/shared/lib/sentences";
import { isMac } from "@/shared/lib/platform";
import { useReadingStore } from "@/shared/store/readingStore";

const STORAGE_KEY = "vivepdf.speech";
export const NEURAL_PREFIX = "neural:";
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;
export const SPEECH_CHUNK_CHARS = 240;
export const VOICES_WAIT_MS = 1500;

export type SpeechStatus = "idle" | "speaking" | "paused";
export type SpeechOwner = "selection" | "page";

export type SpeakOptions = {
  lang?: string;
  rate?: number;
  volume?: number;
  voiceUri?: string | null;
  owner?: SpeechOwner;
  onEnd?: () => void;
  onError?: (event: SpeechSynthesisErrorEvent) => void;
  onInterrupt?: () => void;
  onVoiceFallback?: (voice: SpeechSynthesisVoice) => void;
};

export type VoiceChoice = { voice: SpeechSynthesisVoice | null; matched: boolean };

export const MISSING_VOICE_ERRORS = new Set(["language-unavailable", "voice-unavailable", "synthesis-unavailable"]);

export function chooseVoice(available: SpeechSynthesisVoice[], voiceUri: string | null | undefined, locale: string): VoiceChoice {
  const wanted = voiceUri && !voiceUri.startsWith(NEURAL_PREFIX) ? voiceUri : null;
  const chosen = wanted ? available.find((voice) => voice.voiceURI === wanted) : undefined;
  if (chosen) return { voice: chosen, matched: true };
  const sameLanguage = locale ? available.find((voice) => languageOf(voice.lang) === languageOf(locale)) : undefined;
  if (sameLanguage) return { voice: sameLanguage, matched: true };
  const fallback = available.find((voice) => voice.default) ?? available[0] ?? null;
  return { voice: fallback, matched: !locale || fallback === null };
}

export function speechFailureKey(error: string): string | null {
  if (error === "interrupted" || error === "canceled") return null;
  return MISSING_VOICE_ERRORS.has(error) ? (isMac ? "viewer.readAloud.noVoiceHelpMac" : "viewer.readAloud.noVoiceHelp") : "viewer.readAloud.failed";
}

let announcedFallback = "";

export function speechChunks(text: string): string[] {
  return splitSentences(text, SPEECH_CHUNK_CHARS);
}

export function languageOf(locale: string): string {
  return locale.split("-")[0].toLowerCase();
}

export function speechSynthesisApi(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const synth: SpeechSynthesis | undefined = window.speechSynthesis;
  return synth ?? null;
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return VOLUME_MAX;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value));
}

export function resolveSystemVoice(voiceUri: string | null | undefined, locale: string): SpeechSynthesisVoice | null {
  const synth = speechSynthesisApi();
  if (!synth) return null;
  return chooseVoice(synth.getVoices(), voiceUri, locale).voice;
}

export function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return VOLUME_MAX;
    const parsed = JSON.parse(raw) as { volume?: unknown };
    return typeof parsed.volume === "number" ? clampVolume(parsed.volume) : VOLUME_MAX;
  } catch {
    return VOLUME_MAX;
  }
}

function persistVolume(volume: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume }));
  } catch {
    void 0;
  }
}

type SpeechState = {
  status: SpeechStatus;
  text: string;
  owner: SpeechOwner | null;
  volume: number;
  setVolume: (value: number) => void;
  speak: (text: string, options?: SpeakOptions) => boolean;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  release: () => void;
};

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeInterrupt: (() => void) | null = null;
let speechGeneration = 0;
let startPending = false;

export function whenVoicesReady(synth: SpeechSynthesis, start: () => void): void {
  if (synth.getVoices().length > 0) {
    start();
    return;
  }
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    window.clearTimeout(timer);
    synth.removeEventListener?.("voiceschanged", begin);
    start();
  };
  const timer = window.setTimeout(begin, VOICES_WAIT_MS);
  synth.addEventListener?.("voiceschanged", begin);
}

function detachActive(): (() => void) | null {
  const interrupted = activeUtterance || startPending ? activeInterrupt : null;
  speechGeneration += 1;
  startPending = false;
  activeUtterance = null;
  activeInterrupt = null;
  speechSynthesisApi()?.cancel();
  return interrupted;
}

export const useSpeechStore = create<SpeechState>((set, get) => ({
  status: "idle",
  text: "",
  owner: null,
  volume: readStoredVolume(),
  setVolume: (value) => {
    const volume = clampVolume(value);
    persistVolume(volume);
    set({ volume });
  },
  speak: (text, options) => {
    const synth = speechSynthesisApi();
    const parts = speechChunks(text);
    if (!synth || parts.length === 0) return false;
    const interrupted = detachActive();
    set({ status: "idle", text: "", owner: null });
    interrupted?.();
    const reading = useReadingStore.getState();
    const lang = options?.lang ?? "";
    const voiceUri = options?.voiceUri === undefined ? reading.voiceUri : options.voiceUri;
    let choice: VoiceChoice = { voice: null, matched: true };
    const rate = options?.rate ?? reading.rate;
    const volume = clampVolume(options?.volume ?? get().volume);
    const finish = () => {
      activeUtterance = null;
      activeInterrupt = null;
      set({ status: "idle", text: "", owner: null });
    };
    const speakPart = (index: number) => {
      const utterance = new SpeechSynthesisUtterance(parts[index]);
      if (choice.voice) utterance.voice = choice.voice;
      if (choice.voice?.lang || lang) utterance.lang = choice.voice?.lang ?? lang;
      utterance.rate = rate;
      utterance.volume = volume;
      utterance.onend = () => {
        if (activeUtterance !== utterance) return;
        if (index + 1 < parts.length) {
          speakPart(index + 1);
          return;
        }
        finish();
        options?.onEnd?.();
      };
      utterance.onerror = (event) => {
        if (activeUtterance !== utterance) return;
        finish();
        options?.onError?.(event);
      };
      utterance.onpause = () => {
        if (activeUtterance === utterance) set({ status: "paused" });
      };
      utterance.onresume = () => {
        if (activeUtterance === utterance) set({ status: "speaking" });
      };
      activeUtterance = utterance;
      synth.speak(utterance);
    };
    activeInterrupt = options?.onInterrupt ?? null;
    set({ status: "speaking", text, owner: options?.owner ?? "selection" });
    const generation = speechGeneration;
    startPending = true;
    whenVoicesReady(synth, () => {
      if (generation !== speechGeneration) return;
      startPending = false;
      choice = chooseVoice(synth.getVoices(), voiceUri, lang);
      const fallbackKey = choice.voice && !choice.matched ? `${languageOf(lang)}|${choice.voice.voiceURI}` : "";
      if (choice.voice && fallbackKey && fallbackKey !== announcedFallback) {
        announcedFallback = fallbackKey;
        options?.onVoiceFallback?.(choice.voice);
      }
      speakPart(0);
    });
    return true;
  },
  pause: () => {
    const synth = speechSynthesisApi();
    if (!synth || get().status !== "speaking") return;
    synth.pause();
    set({ status: "paused" });
  },
  resume: () => {
    const synth = speechSynthesisApi();
    if (!synth || get().status !== "paused") return;
    synth.resume();
    set({ status: "speaking" });
  },
  stop: () => {
    const interrupted = detachActive();
    set({ status: "idle", text: "", owner: null });
    interrupted?.();
  },
  release: () => {
    detachActive();
    set({ status: "idle", text: "", owner: null });
  },
}));
