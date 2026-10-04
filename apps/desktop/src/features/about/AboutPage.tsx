import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Bug, ChevronRight, Code2, FolderOpen, Globe, HardDrive, Info, Keyboard, Lightbulb, Lock, RefreshCw, Scale, Search, ShieldCheck, Sparkles, Users, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { Logo } from "@/components/shared/Logo";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { cn } from "@/shared/lib/cn";
import { useAppVersion } from "@/shared/hooks/useAppVersion";
import { CreditsTab } from "@/features/about/CreditsTab";
import { REPO_URL, THIRD_PARTY, WEBSITE_URL } from "@/features/about/credits";
import { DOCUMENT_SHORTCUTS, STUDIO_SHORTCUT_GROUPS } from "@/features/studio/design/shortcutList";
import { useReportStore } from "@/shared/store/reportStore";
import type { LucideIcon } from "lucide-react";

type LinkedPanel = "credits" | "privacy" | "shortcuts";
type Panel = LinkedPanel | "licences";
const LINKED_PANELS: LinkedPanel[] = ["credits", "privacy", "shortcuts"];
const PANEL_ICONS: Record<LinkedPanel, LucideIcon> = { credits: Users, privacy: ShieldCheck, shortcuts: Keyboard };

type ShortcutGroup = { id: string; items: Array<{ keys: string; labelKey: string }> };

const SHORTCUTS: ShortcutGroup[] = [
  {
    id: "global",
    items: [
      { keys: "Ctrl O", labelKey: "about.shortcuts.items.open" },
      { keys: "Ctrl Shift N", labelKey: "about.shortcuts.items.newWindow" },
      { keys: "Ctrl Shift V", labelKey: "about.shortcuts.items.clipboard" },
      { keys: "Ctrl K", labelKey: "about.shortcuts.items.palette" },
      { keys: "Ctrl W", labelKey: "about.shortcuts.items.closeDocument" },
      { keys: "Esc", labelKey: "about.shortcuts.items.closeDialog" },
    ],
  },
  {
    id: "viewer",
    items: [
      { keys: "Ctrl F", labelKey: "about.shortcuts.items.search" },
      { keys: "Ctrl P", labelKey: "about.shortcuts.items.print" },
      { keys: "F11", labelKey: "about.shortcuts.items.fullscreen" },
      { keys: "Ctrl +  /  Ctrl −  /  Ctrl Wheel", labelKey: "about.shortcuts.items.zoom" },
      { keys: "Ctrl 0  /  Ctrl 1  /  Ctrl 2", labelKey: "about.shortcuts.items.zoomModes" },
      { keys: "Space + Drag  ·  Middle Drag", labelKey: "about.shortcuts.items.panDrag" },
      { keys: "PgUp / PgDn  ·  ← →", labelKey: "about.shortcuts.items.pages" },
      { keys: "Home / End", labelKey: "about.shortcuts.items.firstLast" },
      { keys: "Alt ←  /  Alt →", labelKey: "about.shortcuts.items.navigateHistory" },
      { keys: "Delete", labelKey: "about.shortcuts.items.deleteAnnotation" },
      { keys: "Ctrl Z  /  Ctrl Y", labelKey: "about.shortcuts.items.undoRedoViewer" },
      { keys: "Ctrl Shift H", labelKey: "about.shortcuts.items.autoScroll" },
      { keys: "Ctrl Shift E", labelKey: "about.shortcuts.items.splitView" },
      { keys: "↑ ↓  ·  −  ·  Esc", labelKey: "about.shortcuts.items.autoScrollControl" },
    ],
  },
  {
    id: "editor",
    items: [
      { keys: "Delete / Backspace", labelKey: "about.shortcuts.items.editDelete" },
      { keys: "Enter", labelKey: "about.shortcuts.items.editEnter" },
      { keys: "Esc", labelKey: "about.shortcuts.items.editEscape" },
      { keys: "Ctrl S  /  Ctrl Shift S", labelKey: "about.shortcuts.items.editSave" },
      { keys: "Ctrl B  /  Ctrl I", labelKey: "about.shortcuts.items.editStyle" },
      { keys: "Ctrl D", labelKey: "about.shortcuts.items.editDuplicate" },
      { keys: "← → ↑ ↓  ·  Shift", labelKey: "about.shortcuts.items.editNudge" },
    ],
  },
  {
    id: "presentation",
    items: [
      { keys: "F11", labelKey: "about.shortcuts.items.presentationEnter" },
      { keys: "F5  /  Shift F5", labelKey: "about.shortcuts.items.presentationStart" },
      { keys: "L", labelKey: "about.shortcuts.items.presentationLaser" },
      { keys: "P", labelKey: "about.shortcuts.items.presentationPen" },
      { keys: "H", labelKey: "about.shortcuts.items.presentationHighlighter" },
      { keys: "E", labelKey: "about.shortcuts.items.presentationEraser" },
      { keys: "S", labelKey: "about.shortcuts.items.presentationSpotlight" },
      { keys: "M", labelKey: "about.shortcuts.items.presentationMagnifier" },
      { keys: "Z", labelKey: "about.shortcuts.items.presentationZoomArea" },
      { keys: "B  /  W  /  .", labelKey: "about.shortcuts.items.presentationBlackout" },
      { keys: "G", labelKey: "about.shortcuts.items.presentationOverview" },
      { keys: "K", labelKey: "about.shortcuts.items.presentationCodeBlocks" },
      { keys: "T  /  C", labelKey: "about.shortcuts.items.presentationTimerClock" },
      { keys: "Ctrl Z  /  Ctrl Y", labelKey: "about.shortcuts.items.presentationUndoRedo" },
      { keys: "Esc", labelKey: "about.shortcuts.items.presentationEscape" },
    ],
  },
  {
    id: "organizer",
    items: [
      { keys: "Ctrl A", labelKey: "about.shortcuts.items.selectAll" },
      { keys: "Esc", labelKey: "about.shortcuts.items.selectNone" },
      { keys: "Delete", labelKey: "about.shortcuts.items.deletePages" },
      { keys: "R  /  Shift R", labelKey: "about.shortcuts.items.rotate" },
      { keys: "Ctrl D", labelKey: "about.shortcuts.items.duplicate" },
      { keys: "Ctrl Z  /  Ctrl Y", labelKey: "about.shortcuts.items.undoRedo" },
      { keys: "Ctrl Enter", labelKey: "about.shortcuts.items.apply" },
      { keys: "Ctrl +  /  Ctrl −  /  Ctrl Wheel", labelKey: "about.shortcuts.items.thumbnailSize" },
      { keys: "← → ↑ ↓", labelKey: "about.shortcuts.items.move" },
    ],
  },
  { id: "studio", items: STUDIO_SHORTCUT_GROUPS.flatMap((group) => group.items) },
  { id: "studioDocument", items: DOCUMENT_SHORTCUTS },
];

function Eyebrow({ children }: { children: string }) {
  return <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
}

function Chip({ children }: { children: string }) {
  return (
    <span className="glass-chip truncate rounded-full px-3 py-1 text-xs font-medium text-muted-foreground" title={children}>
      {children}
    </span>
  );
}

function Principle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border p-4">
      <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </li>
  );
}

function ListLink({ icon: Icon, label, onClick, chevron }: { icon: LucideIcon; label: string; onClick: () => void; chevron?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="nav-glass flex h-10 w-full items-center gap-3 rounded-lg px-3 text-start text-sm text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {chevron ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </button>
    </li>
  );
}

function FooterLink({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function PrivacyItem({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <li className="flex items-start gap-3 border-b py-3 text-sm last:border-b-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span>{text}</span>
    </li>
  );
}

function StoredItem({ titleText, description, dataLinkLabel, onOpenSettings }: { titleText: string; description: string; dataLinkLabel: string; onOpenSettings: () => void }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <span className="block font-medium">{titleText}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {dataLinkLabel}
      </button>
    </li>
  );
}

function PrivacyContent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6">{t("about.privacy.intro")}</p>
      <div>
        <Eyebrow>{t("about.privacy.networkTitle")}</Eyebrow>
        <ul className="rounded-xl border px-4">
          <PrivacyItem icon={HardDrive} text={t("about.privacy.network.documents")} />
          <PrivacyItem icon={RefreshCw} text={t("about.privacy.network.updates")} />
          <PrivacyItem icon={Globe} text={t("about.privacy.network.voices")} />
          <PrivacyItem icon={Users} text={t("about.privacy.network.contributors")} />
          <PrivacyItem icon={Search} text={t("about.privacy.network.webSearch")} />
          <PrivacyItem icon={ShieldCheck} text={t("about.privacy.network.timestamp")} />
          <PrivacyItem icon={Bug} text={t("about.privacy.network.reports")} />
        </ul>
      </div>
      <div>
        <Eyebrow>{t("about.privacy.storedTitle")}</Eyebrow>
        <ul className="rounded-xl border px-4">
          {(["recent", "session", "settings", "certificate", "backups", "searchIndex", "history", "watchFolders", "signatures", "voices", "logs"] as const).map((key) => (
            <StoredItem
              key={key}
              titleText={t(`about.privacy.stored.${key}.title`)}
              description={t(`about.privacy.stored.${key}.description`)}
              dataLinkLabel={t("about.privacy.openData")}
              onOpenSettings={onOpenSettings}
            />
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{t("about.privacy.clear")}</p>
      </div>
    </div>
  );
}

function splitKeys(keys: string): string[] {
  return keys.split(/\s*(?:\/|·)\s*/).filter(Boolean);
}

function ShortcutsContent() {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const language = i18n.language;
    const needle = query.trim().toLocaleLowerCase(language);
    if (!needle) return SHORTCUTS;
    return SHORTCUTS.map((group) => ({
      ...group,
      items: group.items.filter((item) => t(item.labelKey).toLocaleLowerCase(language).includes(needle) || item.keys.toLocaleLowerCase(language).includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query, t, i18n.language]);

  return (
    <div className="space-y-4">
      <div className="glass-flat relative flex h-9 items-center rounded-lg border ps-9">
        <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("about.shortcuts.search")}
          aria-label={t("about.shortcuts.search")}
          className="h-full w-full bg-transparent pe-3 text-sm text-start outline-none placeholder:text-muted-foreground"
        />
      </div>
      {groups.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("about.shortcuts.noMatch")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {groups.map((group) => (
            <div key={group.id} className={cn("rounded-xl border p-4", (group.id === "organizer" || group.id === "presentation" || group.id === "studio") && "col-span-2")}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Keyboard className="size-3.5" aria-hidden />
                {t(`about.shortcuts.groups.${group.id}`)}
              </p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.keys} className="flex h-row items-center justify-between gap-4 border-b text-sm last:border-b-0">
                    <span className="truncate text-start" title={t(item.labelKey)}>
                      {t(item.labelKey)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {splitKeys(item.keys).map((combo, index) => (
                        <kbd key={index} className="rounded-sm border bg-background px-1.5 font-mono text-xs text-muted-foreground">
                          {combo}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isLinkedPanel(value: string | null): value is LinkedPanel {
  return value !== null && (LINKED_PANELS as string[]).includes(value);
}

export function AboutPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const backParam = `&from=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  const version = useAppVersion();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPanel = searchParams.get("tab");
  const [panel, setPanel] = useState<Panel | null>(isLinkedPanel(requestedPanel) ? requestedPanel : null);

  useEffect(() => {
    if (isLinkedPanel(requestedPanel)) setPanel(requestedPanel);
  }, [requestedPanel]);

  const openPanel = (next: Panel) => {
    setPanel(next);
    if (isLinkedPanel(next)) setSearchParams({ tab: next }, { replace: true });
  };

  const closePanel = () => {
    setPanel(null);
    if (searchParams.has("tab")) setSearchParams({}, { replace: true });
  };

  const openSettingsData = () => {
    closePanel();
    navigate(`/settings?section=data${backParam}`);
  };

  const year = new Date().getFullYear();
  const panelTitle = panel === "licences" ? t("about.licences.title") : panel ? t(`about.tabs.${panel}`) : "";

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("nav.about")} description={t("about.tagline")} icon={Info} eyebrow={t("app.name")} />
      <div className="min-h-0 overflow-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <section className="glass glass-tinted relative overflow-hidden rounded-2xl px-8 py-10 text-center">
            <Logo size={72} className="mx-auto" />
            <p className="mt-4 text-display font-semibold tracking-tight">
              vive<span className="text-primary">PDF</span>
            </p>
            <p className="mx-auto mt-2 max-w-xl text-base text-muted-foreground">{t("about.tagline")}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Chip>{`${t("about.version")} ${version}`}</Chip>
              <Chip>Windows · macOS · Linux</Chip>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="primary" size="sm" icon={<Globe className="size-4" aria-hidden />} onClick={() => void openUrl(WEBSITE_URL)}>
                vivepdf.com
              </Button>
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => navigate(`/settings?section=updates${backParam}`)}>
                {t("about.actions.checkUpdates")}
              </Button>
            </div>
          </section>

          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
            <section className="glass rounded-2xl p-6">
              <Eyebrow>{t("about.productTitle")}</Eyebrow>
              <p className="measure text-base leading-6">{t("about.statement")}</p>
              <p className="mt-3 measure text-sm text-muted-foreground">{t("about.statementSecondary")}</p>
              <div className="mt-6 border-t pt-5">
                <Eyebrow>{t("about.principlesTitle")}</Eyebrow>
                <ul className="grid gap-3 md:grid-cols-3">
                  <Principle icon={WifiOff} title={t("about.principles.offline.title")} description={t("about.principles.offline.description")} />
                  <Principle icon={Lock} title={t("about.principles.noTelemetry.title")} description={t("about.principles.noTelemetry.description")} />
                  <Principle icon={Sparkles} title={t("about.principles.free.title")} description={t("about.principles.free.description")} />
                </ul>
              </div>
            </section>
            <div className="space-y-4">
              <section className="glass rounded-2xl p-4">
                <div className="px-2">
                  <Eyebrow>{t("about.moreTitle")}</Eyebrow>
                </div>
                <ul className="space-y-0.5">
                  {LINKED_PANELS.map((item) => (
                    <ListLink key={item} icon={PANEL_ICONS[item]} label={t(`about.tabs.${item}`)} onClick={() => openPanel(item)} chevron />
                  ))}
                </ul>
              </section>
              <section className="glass rounded-2xl p-4">
                <div className="px-2">
                  <Eyebrow>{t("about.supportTitle")}</Eyebrow>
                </div>
                <ul className="space-y-0.5">
                  <ListLink icon={Bug} label={t("about.reportBug")} onClick={() => useReportStore.getState().openDialog({ category: "bug" })} />
                  <ListLink icon={Lightbulb} label={t("about.suggestFeature")} onClick={() => useReportStore.getState().openDialog({ category: "idea" })} />
                  <ListLink icon={FolderOpen} label={t("app.openLogDir")} onClick={() => void invoke("open_log_dir")} />
                </ul>
              </section>
            </div>
          </div>

          <footer className="rounded-2xl border bg-card px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Logo size={32} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-5 tracking-tight">
                    vive<span className="text-primary">PDF</span>
                  </p>
                  <p className="truncate text-xs leading-4 text-muted-foreground">{t("about.tagline")}</p>
                </div>
              </div>
              <nav className="flex flex-wrap items-center gap-1">
                <FooterLink icon={Globe} label="vivepdf.com" onClick={() => void openUrl(WEBSITE_URL)} />
                <FooterLink icon={Scale} label={t("about.footer.licences")} onClick={() => openPanel("licences")} />
                <FooterLink icon={Code2} label={t("about.footer.source")} onClick={() => void openUrl(REPO_URL)} />
              </nav>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>{t("about.footer.copyright", { year })}</span>
              <span className="font-mono text-[11px]">{`${t("about.version")} ${version}`}</span>
            </div>
          </footer>
        </div>
      </div>
      <Dialog open={panel !== null} title={panelTitle} onClose={closePanel} size={panel === "licences" ? "md" : "xl"}>
        {panel === "credits" ? <CreditsTab /> : null}
        {panel === "privacy" ? <PrivacyContent onOpenSettings={openSettingsData} /> : null}
        {panel === "shortcuts" ? <ShortcutsContent /> : null}
        {panel === "licences" ? (
          <>
            <p className="text-sm text-muted-foreground">{t("about.licences.intro")}</p>
            <ul className="mt-3 max-h-80 overflow-auto rounded-xl border">
              {THIRD_PARTY.map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-4 border-b px-3 py-2 text-sm last:border-b-0">
                  <button type="button" onClick={() => void openUrl(entry.url)} className="min-w-0 truncate text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={entry.url}>
                    {entry.name}
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{entry.licence}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
