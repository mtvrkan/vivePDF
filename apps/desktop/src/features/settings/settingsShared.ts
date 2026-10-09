import { createContext, useEffect, useState } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  BookOpen,
  Database,
  FileOutput,
  Globe,
  MessageSquareWarning,
  Palette,
  Presentation,
  Rocket,
  Volume2,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { readSavedChains } from "@/features/tools/batch/chain";
import type { Tone } from "@/types";

export const CERTIFICATE_KEY = "vivepdf.certificatePath";
export const SEARCH_HISTORY_KEY = "vivepdf.searchHistory";
export const SECTION_GROUPS = [
  { id: "app", tone: "organize", sections: ["appearance", "general", "files", "web"] },
  { id: "viewing", tone: "improve", sections: ["viewer", "reading", "presentation"] },
  { id: "system", tone: "fromPdf", sections: ["tools", "updates", "system", "data", "feedback"] },
] as const satisfies readonly { id: string; tone: Tone; sections: readonly string[] }[];
export type SectionId = (typeof SECTION_GROUPS)[number]["sections"][number];
export const SECTION_IDS: SectionId[] = SECTION_GROUPS.flatMap((group) => [...group.sections]);
export const SECTION_TONES = Object.fromEntries(SECTION_GROUPS.flatMap((group) => group.sections.map((id) => [id, group.tone]))) as Record<SectionId, Tone>;
export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  appearance: Palette,
  general: Rocket,
  files: FileOutput,
  web: Globe,
  viewer: BookOpen,
  reading: Volume2,
  presentation: Presentation,
  tools: Wrench,
  updates: ArrowDownToLine,
  system: AppWindow,
  data: Database,
  feedback: MessageSquareWarning,
};

export type SettingsSectionProps = {
  query: string;
  onEmptyChange: (id: SectionId, empty: boolean) => void;
};

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readStoredCount(key: string): number {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function isSectionId(value: string | null | undefined): value is SectionId {
  return typeof value === "string" && (SECTION_IDS as readonly string[]).includes(value);
}

export const SettingsSearchContext = createContext("");

export function countChainsWithSecrets(): number {
  return readSavedChains().filter((chain) => (chain.storedSecrets?.length ?? 0) > 0).length;
}

export function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, []);
  return voices;
}
