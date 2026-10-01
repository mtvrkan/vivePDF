import { AppWindow, Bug, Clock, Database, Download, Eye, FileInput, FileSearch, FileText, FolderOpen, FolderSync, Globe, Hash, History, Lightbulb, MessageSquare, Monitor, MonitorCog, Moon, Palette, Presentation, Printer, RefreshCw, Rocket, Search, Sun, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { primaryNavigation, secondaryNavigation, toolShortcuts } from "@/app/navigation";
import { parsePageQuery } from "@/components/layout/paletteMatch";
import type { OpenDocument, RecentFile, ThemeMode, Tone } from "@/types";

export type PaletteEntryKind = "tool" | "page" | "settings" | "action" | "document" | "recent" | "search" | "page-jump";

export type PaletteEntry = {
  id: string;
  kind: PaletteEntryKind;
  title: string;
  subtitle: string;
  keywords: string;
  icon: LucideIcon;
  tone?: Tone;
  monoSubtitle?: boolean;
  secondaryLabel?: string;
  secondaryIcon?: LucideIcon;
  secondaryRun?: () => void;
  run: () => void;
};

export const SETTINGS_SECTIONS = [
  "appearance",
  "general",
  "files",
  "web",
  "viewer",
  "reading",
  "presentation",
  "tools",
  "updates",
  "system",
  "data",
  "feedback",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

const SETTINGS_SECTION_ICONS: Record<SettingsSectionId, LucideIcon> = {
  appearance: Palette,
  general: Rocket,
  viewer: FileText,
  reading: Eye,
  presentation: Presentation,
  tools: Wrench,
  files: FolderSync,
  web: Globe,
  updates: Download,
  system: Monitor,
  data: Database,
  feedback: MessageSquare,
};

export function buildToolEntries(t: TFunction, go: (route: string) => void): PaletteEntry[] {
  return toolShortcuts.map((tool) => {
    const title = t(tool.labelKey);
    const groupLabel = t(`tools.grid.groups.${tool.group}`);
    return {
      id: `tool:${tool.id}`,
      kind: "tool",
      title,
      subtitle: groupLabel,
      keywords: `${tool.keywords} ${t(tool.descriptionKey)}`,
      icon: tool.icon,
      tone: tool.group,
      run: () => go(tool.route),
    };
  });
}

export function buildPageEntries(t: TFunction, go: (route: string) => void): PaletteEntry[] {
  return [...primaryNavigation, ...secondaryNavigation].map((item) => ({
    id: `page:${item.id}`,
    kind: "page",
    title: t(item.labelKey),
    subtitle: t("palette.page"),
    keywords: "",
    icon: item.icon,
    run: () => go(item.route),
  }));
}

export function buildSettingsEntries(t: TFunction, go: (route: string) => void): PaletteEntry[] {
  return SETTINGS_SECTIONS.map((id) => ({
    id: `settings:${id}`,
    kind: "settings",
    title: t(`palette.settingsSection.${id}`),
    subtitle: t("palette.settings"),
    keywords: "settings ayarlar",
    icon: SETTINGS_SECTION_ICONS[id],
    run: () => go(`/settings?section=${id}`),
  }));
}

export type ActionContext = {
  pickAndOpen: () => void;
  openWindow: () => void;
  goToSearch: () => void;
  hasSession: boolean;
  restoreSession: () => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  checkUpdates: () => void;
  openReportBug: () => void;
  openSuggestFeature: () => void;
  openLogDir: () => void;
  hasActiveDocument: boolean;
  openPrint: () => void;
};

export function buildActionEntries(t: TFunction, ctx: ActionContext): PaletteEntry[] {
  const entries: PaletteEntry[] = [
    {
      id: "action:open",
      kind: "action",
      title: t("palette.action.open"),
      subtitle: t("palette.actionLabel"),
      keywords: "open pdf ac",
      icon: FileInput,
      run: ctx.pickAndOpen,
    },
    {
      id: "action:newWindow",
      kind: "action",
      title: t("palette.action.newWindow"),
      subtitle: t("palette.actionLabel"),
      keywords: "new window second monitor yeni pencere ctrl shift n",
      icon: AppWindow,
      run: ctx.openWindow,
    },
    {
      id: "action:searchFolder",
      kind: "action",
      title: t("palette.action.searchFolder"),
      subtitle: t("palette.actionLabel"),
      keywords: "search folder index klasor ara",
      icon: Search,
      run: ctx.goToSearch,
    },
    {
      id: "action:themeLight",
      kind: "action",
      title: t("palette.action.themeLight"),
      subtitle: t("palette.actionLabel"),
      keywords: "theme light aydinlik",
      icon: Sun,
      run: () => ctx.setTheme("light"),
    },
    {
      id: "action:themeDark",
      kind: "action",
      title: t("palette.action.themeDark"),
      subtitle: t("palette.actionLabel"),
      keywords: "theme dark karanlik",
      icon: Moon,
      run: () => ctx.setTheme("dark"),
    },
    {
      id: "action:themeSystem",
      kind: "action",
      title: t("palette.action.themeSystem"),
      subtitle: t("palette.actionLabel"),
      keywords: "theme system sistem",
      icon: MonitorCog,
      run: () => ctx.setTheme("system"),
    },
    {
      id: "action:checkUpdates",
      kind: "action",
      title: t("palette.action.checkUpdates"),
      subtitle: t("palette.actionLabel"),
      keywords: "update guncelle",
      icon: RefreshCw,
      run: ctx.checkUpdates,
    },
    {
      id: "action:reportBug",
      kind: "action",
      title: t("palette.action.reportBug"),
      subtitle: t("palette.actionLabel"),
      keywords: "bug report hata bildir",
      icon: Bug,
      run: ctx.openReportBug,
    },
    {
      id: "action:suggestFeature",
      kind: "action",
      title: t("palette.action.suggestFeature"),
      subtitle: t("palette.actionLabel"),
      keywords: "feature idea oneri",
      icon: Lightbulb,
      run: ctx.openSuggestFeature,
    },
    {
      id: "action:openLogDir",
      kind: "action",
      title: t("palette.action.openLogDir"),
      subtitle: t("palette.actionLabel"),
      keywords: "log klasor",
      icon: FolderOpen,
      run: ctx.openLogDir,
    },
  ];
  if (ctx.hasSession) {
    entries.push({
      id: "action:restoreSession",
      kind: "action",
      title: t("palette.action.restoreSession"),
      subtitle: t("palette.actionLabel"),
      keywords: "session restore oturum",
      icon: History,
      run: ctx.restoreSession,
    });
  }
  if (ctx.hasActiveDocument) {
    entries.push({
      id: "action:print",
      kind: "action",
      title: t("palette.action.print"),
      subtitle: t("palette.actionLabel"),
      keywords: "print yazdir",
      icon: Printer,
      run: ctx.openPrint,
    });
  }
  return entries;
}

export function buildDocumentEntries(
  t: TFunction,
  documents: OpenDocument[],
  activeId: string | null,
  activate: (id: string) => void,
  closeDocument: (id: string) => void,
): PaletteEntry[] {
  return documents
    .filter((document) => document.id !== activeId)
    .map((document) => ({
      id: `document:${document.id}`,
      kind: "document",
      title: t("palette.action.switchTo", { fileName: document.fileName }),
      subtitle: document.path,
      keywords: document.fileName,
      icon: FileText,
      monoSubtitle: true,
      secondaryLabel: t("palette.action.closeDocument"),
      secondaryIcon: X,
      secondaryRun: () => closeDocument(document.id),
      run: () => activate(document.id),
    }));
}

export function buildRecentEntries(
  t: TFunction,
  recent: RecentFile[],
  openPath: (path: string) => void,
  revealPath: (path: string) => void,
): PaletteEntry[] {
  return recent.map((item) => ({
    id: `recent:${item.path}`,
    kind: "recent",
    title: item.fileName,
    subtitle: item.path,
    keywords: item.fileName,
    icon: Clock,
    monoSubtitle: true,
    secondaryLabel: t("palette.action.revealInFolder"),
    secondaryIcon: FolderOpen,
    secondaryRun: () => revealPath(item.path),
    run: () => openPath(item.path),
  }));
}

export type DocumentQueryContext = {
  activeDocument: OpenDocument | null;
  requestSearchInDocument: (query: string) => void;
  requestPageJump: (path: string, page: number) => void;
};

export function buildDocumentQueryEntries(t: TFunction, query: string, ctx: DocumentQueryContext): PaletteEntry[] {
  const trimmed = query.trim();
  if (!trimmed || !ctx.activeDocument) return [];
  const entries: PaletteEntry[] = [];
  const page = parsePageQuery(trimmed);
  if (page !== null) {
    const path = ctx.activeDocument.path;
    entries.push({
      id: "page-jump:current",
      kind: "page-jump",
      title: t("palette.goToPage", { page }),
      subtitle: ctx.activeDocument.fileName,
      keywords: "",
      icon: Hash,
      run: () => ctx.requestPageJump(path, page),
    });
    return entries;
  }
  entries.push({
    id: "search:document",
    kind: "search",
    title: t("palette.searchInDocument", { query: trimmed }),
    subtitle: ctx.activeDocument.fileName,
    keywords: "",
    icon: FileSearch,
    run: () => ctx.requestSearchInDocument(trimmed),
  });
  return entries;
}
