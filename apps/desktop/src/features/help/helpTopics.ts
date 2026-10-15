import { ArrowLeftRight, FilePen, FolderOpen, LayoutGrid, LifeBuoy, Palette, PenTool, Presentation, ScanText, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import type { StudioScreen } from "@/features/about/shortcutSheetStore";

export const HELP_TOPIC_IDS = ["openView", "organizePages", "convert", "ocr", "sign", "studioDocument", "studioDesign", "presentation", "settingsPrivacy", "troubleshooting"] as const;
export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

export type HelpTopic = {
  id: HelpTopicId;
  steps: number;
  icon: LucideIcon;
  route?: string;
};

export const HELP_TOPICS: HelpTopic[] = [
  { id: "openView", steps: 5, icon: FolderOpen, route: "/" },
  { id: "organizePages", steps: 5, icon: LayoutGrid, route: "/pages" },
  { id: "convert", steps: 4, icon: ArrowLeftRight, route: "/tools/convert" },
  { id: "ocr", steps: 4, icon: ScanText, route: "/tools/ocr" },
  { id: "sign", steps: 5, icon: PenTool, route: "/tools/sign" },
  { id: "studioDocument", steps: 5, icon: FilePen, route: "/studio?start=document" },
  { id: "studioDesign", steps: 5, icon: Palette, route: "/studio" },
  { id: "presentation", steps: 5, icon: Presentation, route: "/viewer" },
  { id: "settingsPrivacy", steps: 4, icon: Settings, route: "/settings" },
  { id: "troubleshooting", steps: 5, icon: LifeBuoy },
];

const ROUTE_TOPICS: Array<[string, HelpTopicId]> = [
  ["/viewer", "openView"],
  ["/pages", "organizePages"],
  ["/tools/pages", "organizePages"],
  ["/tools/merge", "organizePages"],
  ["/tools/split", "organizePages"],
  ["/tools/convert", "convert"],
  ["/tools/ocr", "ocr"],
  ["/tools/sign", "sign"],
  ["/settings", "settingsPrivacy"],
  ["/about", "troubleshooting"],
];

export function helpTopic(id: string | null): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id);
}

export function helpTopicFor(pathname: string, immersive: boolean, studio: StudioScreen): HelpTopicId {
  if (immersive) return "presentation";
  if (pathname === "/studio") return studio === "document" ? "studioDocument" : "studioDesign";
  return ROUTE_TOPICS.find(([route]) => route === pathname)?.[1] ?? "openView";
}

export function helpTopicText(t: TFunction, topic: HelpTopic): { title: string; summary: string; steps: string[] } {
  const base = `help.topics.${topic.id}`;
  return {
    title: t(`${base}.title`),
    summary: t(`${base}.summary`),
    steps: Array.from({ length: topic.steps }, (_, index) => t(`${base}.step${index + 1}`)),
  };
}

function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/ı/g, "i");
}

export function matchingTopics(t: TFunction, query: string): HelpTopic[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return HELP_TOPICS;
  return HELP_TOPICS.filter((topic) => {
    const { title, summary, steps } = helpTopicText(t, topic);
    const haystack = folded([title, summary, ...steps].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}

export function isHelpTopicKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  return event.key === "F1" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}
