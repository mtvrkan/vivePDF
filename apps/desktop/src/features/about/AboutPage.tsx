import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { BookOpen, Bug, ChevronRight, Code2, Download, FolderOpen, Globe, HardDrive, Info, KeyRound, Keyboard, Lightbulb, Lock, RefreshCw, Scale, Search, ShieldCheck, Sparkles, Users, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openExternal } from "@/shared/lib/openExternal";
import { useOffline } from "@/shared/lib/offline";
import { Logo } from "@/components/shared/Logo";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { checkUpdatesNow, openLogFolder } from "@/shared/lib/helpActions";
import { useAppVersion } from "@/shared/hooks/useAppVersion";
import { CreditsTab } from "@/features/about/CreditsTab";
import { REPO_URL, THIRD_PARTY, WEBSITE_URL } from "@/features/about/credits";
import { SaveShortcutsPdfButton } from "@/features/about/SaveShortcutsPdfButton";
import { ShortcutList } from "@/features/about/ShortcutList";
import { WhatsNewContent } from "@/features/about/WhatsNewContent";
import { SHORTCUT_GROUPS } from "@/features/about/shortcutGroups";
import { useReportStore } from "@/shared/store/reportStore";
import type { LucideIcon } from "lucide-react";

type LinkedPanel = "whatsNew" | "credits" | "privacy" | "shortcuts";
type Panel = LinkedPanel | "licences";
const LINKED_PANELS: LinkedPanel[] = ["whatsNew", "credits", "privacy", "shortcuts"];
const PANEL_ICONS: Record<LinkedPanel, LucideIcon> = { whatsNew: Sparkles, credits: Users, privacy: ShieldCheck, shortcuts: Keyboard };

type StoredTarget = "data" | "general" | "tools" | "logs";

const NETWORK_ITEMS: Array<{ key: string; icon: LucideIcon }> = [
  { key: "documents", icon: HardDrive },
  { key: "updates", icon: RefreshCw },
  { key: "downloads", icon: Download },
  { key: "contributors", icon: Users },
  { key: "webSearch", icon: Search },
  { key: "webPage", icon: Globe },
  { key: "citations", icon: BookOpen },
  { key: "breach", icon: KeyRound },
  { key: "timestamp", icon: ShieldCheck },
  { key: "reports", icon: Bug },
];

const STORED_ITEMS: Array<{ key: string; target: StoredTarget }> = [
  { key: "recent", target: "data" },
  { key: "session", target: "data" },
  { key: "settings", target: "data" },
  { key: "certificate", target: "data" },
  { key: "backups", target: "general" },
  { key: "searchIndex", target: "data" },
  { key: "history", target: "data" },
  { key: "watchFolders", target: "data" },
  { key: "signatures", target: "data" },
  { key: "downloads", target: "tools" },
  { key: "logs", target: "logs" },
];

const STORED_LINK_LABELS: Record<StoredTarget, string> = {
  data: "about.privacy.openData",
  general: "about.privacy.openGeneral",
  tools: "about.privacy.openTools",
  logs: "app.openLogDir",
};

function Eyebrow({ children }: { children: string }) {
  return <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
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

function StoredItem({ titleText, description, linkLabel, onOpen }: { titleText: string; description: string; linkLabel: string; onOpen: () => void }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <span className="block font-medium">{titleText}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {linkLabel}
      </button>
    </li>
  );
}

function PrivacyContent({ onOpenSettings }: { onOpenSettings: (section: string) => void }) {
  const { t } = useTranslation();
  const offline = useOffline();
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6">{t("about.privacy.intro")}</p>
      <div data-testid="privacy-offline" className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-lg">
          {offline ? <WifiOff className="size-4" aria-hidden /> : <Globe className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t(offline ? "about.privacy.offline.on" : "about.privacy.offline.off")}</span>
          <span className="block text-xs leading-5 text-muted-foreground">{t("about.privacy.offline.description")}</span>
        </span>
        <Button size="sm" variant="secondary" onClick={() => onOpenSettings("web")}>
          {t("about.privacy.offline.open")}
        </Button>
      </div>
      <div>
        <Eyebrow>{t("about.privacy.networkTitle")}</Eyebrow>
        <ul className="rounded-xl border px-4">
          {NETWORK_ITEMS.map((item) => (
            <PrivacyItem key={item.key} icon={item.icon} text={t(`about.privacy.network.${item.key}`)} />
          ))}
        </ul>
      </div>
      <div>
        <Eyebrow>{t("about.privacy.storedTitle")}</Eyebrow>
        <ul className="rounded-xl border px-4">
          {STORED_ITEMS.map(({ key, target }) => (
            <StoredItem
              key={key}
              titleText={t(`about.privacy.stored.${key}.title`)}
              description={t(`about.privacy.stored.${key}.description`)}
              linkLabel={t(STORED_LINK_LABELS[target])}
              onOpen={() => (target === "logs" ? void openLogFolder() : onOpenSettings(target))}
            />
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{t("about.privacy.clear")}</p>
      </div>
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

  const openSettingsSection = (section: string) => {
    closePanel();
    navigate(`/settings?section=${section}${backParam}`);
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
              <Button variant="primary" size="sm" icon={<Globe className="size-4" aria-hidden />} onClick={() => void openExternal(WEBSITE_URL)}>
                vivepdf.com
              </Button>
              <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} onClick={() => checkUpdatesNow((to) => navigate(`${to}${backParam}`))}>
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
                  <ListLink icon={FolderOpen} label={t("app.openLogDir")} onClick={() => void openLogFolder()} />
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
                <FooterLink icon={Globe} label="vivepdf.com" onClick={() => void openExternal(WEBSITE_URL)} />
                <FooterLink icon={Scale} label={t("about.footer.licences")} onClick={() => openPanel("licences")} />
                <FooterLink icon={Code2} label={t("about.footer.source")} onClick={() => void openExternal(REPO_URL)} />
              </nav>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>{t("about.footer.copyright", { year })}</span>
              <span className="font-mono text-2xs">{`${t("about.version")} ${version}`}</span>
            </div>
          </footer>
        </div>
      </div>
      <Dialog open={panel !== null} title={panelTitle} onClose={closePanel} size={panel === "licences" ? "md" : "xl"} footer={panel === "shortcuts" ? <SaveShortcutsPdfButton groups={SHORTCUT_GROUPS} /> : undefined}>
        {panel === "whatsNew" ? <WhatsNewContent version={version} onNavigate={closePanel} /> : null}
        {panel === "credits" ? <CreditsTab /> : null}
        {panel === "privacy" ? <PrivacyContent onOpenSettings={openSettingsSection} /> : null}
        {panel === "shortcuts" ? <ShortcutList groups={SHORTCUT_GROUPS} /> : null}
        {panel === "licences" ? (
          <>
            <p className="text-sm text-muted-foreground">{t("about.licences.intro")}</p>
            <ul className="mt-3 max-h-80 overflow-auto rounded-xl border">
              {THIRD_PARTY.map((entry) => (
                <li key={entry.name} className="flex items-center justify-between gap-4 border-b px-3 py-2 text-sm last:border-b-0">
                  <button type="button" onClick={() => void openExternal(entry.url)} className="min-w-0 truncate text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={entry.url}>
                    {entry.name}
                  </button>
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">{entry.licence}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
