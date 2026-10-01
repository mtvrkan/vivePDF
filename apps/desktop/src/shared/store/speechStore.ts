import { create } from "zustand";
import { useReadingStore } from "@/shared/store/readingStore";

const STORAGE_KEY = "vivepdf.speech";
export const NEURAL_PREFIX = "neural:";
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;

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
};

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
  const available = synth.getVoices();
  const wanted = voiceUri && !voiceUri.startsWith(NEURAL_PREFIX) ? voiceUri : null;
  return available.find((voice) => voice.voiceURI === wanted) ?? available.find((voice) => languageOf(voice.lang) === languageOf(locale)) ?? null;
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

function detachActive(): (() => void) | null {
  const interrupted = activeUtterance ? activeInterrupt : null;
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
    const spoken = text.replace(/\s+/g, " ").trim();
    if (!synth || !spoken) return false;
    const interrupted = detachActive();
    set({ status: "idle", text: "", owner: null });
    interrupted?.();
    const reading = useReadingStore.getState();
    const utterance = new SpeechSynthesisUtterance(spoken);
    const lang = options?.lang ?? "";
    const voice = resolveSystemVoice(options?.voiceUri === undefined ? reading.voiceUri : options.voiceUri, lang);
    if (voice) utterance.voice = voice;
    if (voice?.lang || lang) utterance.lang = voice?.lang ?? lang;
    utterance.rate = options?.rate ?? reading.rate;
    utterance.volume = clampVolume(options?.volume ?? get().volume);
    utterance.onend = () => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      activeInterrupt = null;
      set({ status: "idle", text: "", owner: null });
      options?.onEnd?.();
    };
    utterance.onerror = (event) => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      activeInterrupt = null;
      set({ status: "idle", text: "", owner: null });
      options?.onError?.(event);
    };
    utterance.onpause = () => {
      if (activeUtterance === utterance) set({ status: "paused" });
    };
    utterance.onresume = () => {
      if (activeUtterance === utterance) set({ status: "speaking" });
    };
    activeUtterance = utterance;
    activeInterrupt = options?.onInterrupt ?? null;
    set({ status: "speaking", text: spoken, owner: options?.owner ?? "selection" });
    synth.speak(utterance);
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
