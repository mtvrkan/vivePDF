import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseVoice, speechChunks, speechFailureKey, SPEECH_CHUNK_CHARS, useSpeechStore } from "./speechStore";

function voice(name: string, lang: string, isDefault = false): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, default: isDefault, localService: true } as SpeechSynthesisVoice;
}

class FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

let voices: SpeechSynthesisVoice[] = [];
let spoken: FakeUtterance[] = [];

beforeEach(() => {
  voices = [];
  spoken = [];
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("window", {
    speechSynthesis: {
      getVoices: () => voices,
      speak: (utterance: FakeUtterance) => spoken.push(utterance),
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
    },
  });
  useSpeechStore.setState({ status: "idle", text: "", owner: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chooseVoice", () => {
  it("prefers the chosen voice, then one speaking the language", () => {
    const english = voice("David", "en-US", true);
    const turkish = voice("Tolga", "tr-TR");

    expect(chooseVoice([english, turkish], "David", "tr")).toEqual({ voice: english, matched: true });
    expect(chooseVoice([english, turkish], null, "tr")).toEqual({ voice: turkish, matched: true });
  });

  it("falls back to the default voice when none speaks the language and ignores neural voice ids", () => {
    const zira = voice("Zira", "en-US");
    const david = voice("David", "en-US", true);

    expect(chooseVoice([zira, david], "neural:tr-dfki", "tr")).toEqual({ voice: david, matched: false });
    expect(chooseVoice([zira], null, "tr")).toEqual({ voice: zira, matched: false });
  });

  it("returns no voice when the system has none", () => {
    expect(chooseVoice([], "David", "tr")).toEqual({ voice: null, matched: true });
  });
});

describe("speechFailureKey", () => {
  it("points missing voices to the voice help, other failures to the generic message and ignores interruptions", () => {
    expect(speechFailureKey("language-unavailable")).toBe("viewer.readAloud.noVoiceHelp");
    expect(speechFailureKey("synthesis-failed")).toBe("viewer.readAloud.failed");
    expect(speechFailureKey("interrupted")).toBeNull();
  });
});

describe("useSpeechStore.speak", () => {
  it("reads long text sentence by sentence and ends once after the last part", () => {
    const text = Array.from({ length: 6 }, (_, index) => `Sentence ${index} ${"word ".repeat(20)}.`).join(" ");
    const onEnd = vi.fn();

    expect(useSpeechStore.getState().speak(text, { lang: "en", onEnd })).toBe(true);
    while (spoken.length < speechChunks(text).length) spoken[spoken.length - 1].onend?.();
    spoken[spoken.length - 1].onend?.();

    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.every((utterance) => utterance.text.length <= SPEECH_CHUNK_CHARS)).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(useSpeechStore.getState().status).toBe("idle");
  });

  it("announces a fallback voice once per language and speaks with it", () => {
    const david = voice("David", "en-US", true);
    voices = [david];
    const onVoiceFallback = vi.fn();

    useSpeechStore.getState().speak("Merhaba.", { lang: "ko", onVoiceFallback });
    useSpeechStore.getState().speak("Tekrar.", { lang: "ko", onVoiceFallback });

    expect(onVoiceFallback).toHaveBeenCalledTimes(1);
    expect(onVoiceFallback).toHaveBeenCalledWith(david);
    expect(spoken[1].voice).toBe(david);
    expect(spoken[1].lang).toBe("en-US");
  });

  it("stops at the first failing part and reports the error", () => {
    const onError = vi.fn();
    const onEnd = vi.fn();

    useSpeechStore.getState().speak(`${"a ".repeat(150)}. ${"b ".repeat(150)}.`, { lang: "tr", onError, onEnd });
    spoken[0].onerror?.({ error: "language-unavailable" });

    expect(onError).toHaveBeenCalledWith({ error: "language-unavailable" });
    expect(onEnd).not.toHaveBeenCalled();
    expect(spoken).toHaveLength(1);
    expect(useSpeechStore.getState().status).toBe("idle");
  });

  it("refuses empty text", () => {
    expect(useSpeechStore.getState().speak("   ")).toBe(false);
  });
});
