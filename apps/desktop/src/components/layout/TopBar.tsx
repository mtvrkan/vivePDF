import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDownToLine, Bug, Check, CircleHelp, Copy, FolderOpen, Info, Keyboard, Languages, LayoutGrid, Lightbulb, Loader2, Minus, Moon, RefreshCw, RotateCw, Search, Settings, ShieldCheck, Square, Sun, Wrench, X } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { LOCALES } from "@/app/locales";
import { headerNavigation, menuItemsForGroup, toolGroupIcons, toolShortcuts, type ToolGroup } from "@/app/navigation";
import { isDarkTheme } from "@/app/theme";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Logo } from "@/components/shared/Logo";
import { ToolBrowser } from "@/features/home/ToolBrowser";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { cn } from "@/shared/lib/cn";
import { rootFontScale } from "@/shared/lib/uiZoom";
import { useActiveOpenDocument } from "@/shared/store/documentStore";
import { useOpenStore } from "@/shared/store/openStore";
import { usePaletteStore } from "@/shared/store/paletteStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useReportStore } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { useUpdateStore } from "@/shared/store/updateStore";
import type { Locale } from "@/types";
import { HeaderMenu, MenuLink, MenuSeparator } from "./HeaderMenu";

const COMPACT_NAV_BREAKPOINT = 1180;
const COMPACT_SEARCH_BREAKPOINT = 1000;
const COMPACT_ACTIONS_BREAKPOINT = 760;
const HIDE_QUICK_TOGGLES_BREAKPOINT = 720;
const ICON_MENUS_BREAKPOINT = 600;
const HIDE_PRIMARY_NAV_BREAKPOINT = 480;
const TOOL_MENU_COLUMNS: ToolGroup[][] = [["organize", "fromPdf"], ["improve"], ["toPdf", "edit", "security"]];

function runWindowCommand(command: () => Promise<void>) {
  command().catch((error: unknown) => {
    useToastStore.getState().push("error", error instanceof Error ? error.message : String(error));
  });
}

function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
    const unlisten = appWindow.onResized(() => {
      void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
    });
    return () => {
      void unlisten.then((stop) => stop()).catch(() => undefined);
    };
  }, []);

  const control =
    "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

  return (
    <div className="ms-1 flex h-full items-stretch">
      <button type="button" aria-label={t("window.minimize")} onClick={() => runWindowCommand(() => getCurrentWindow().minimize())} className={control}>
        <Minus className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        onClick={() => runWindowCommand(() => getCurrentWindow().toggleMaximize())}
        className={control}
      >
        {maximized ? <Copy className="size-3.5" aria-hidden /> : <Square className="size-3.5" aria-hidden />}
      </button>
      <button
        type="button"
        aria-label={t("window.close")}
        onClick={() => runWindowCommand(() => getCurrentWindow().close())}
        className={cn(control, "hover:bg-destructive hover:text-destructive-foreground")}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function UpdateBadge({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.version);
  const progress = useUpdateStore((state) => state.progress);
  const install = useUpdateStore((state) => state.install);
  const restart = useUpdateStore((state) => state.restart);

  if (status !== "available" && status !== "downloading" && status !== "ready") return null;

  const label =
    status === "available"
      ? t("update.availableShort", { version })
      : status === "downloading"
        ? t("update.downloading", { percent: Math.round(progress * 100) })
        : t("update.restart");
  const Icon = status === "available" ? ArrowDownToLine : status === "downloading" ? Loader2 : RotateCw;
  const action = status === "available" ? () => void install() : status === "ready" ? () => void restart() : undefined;

  return (
    <button
      type="button"
      onClick={action}
      disabled={!action}
      aria-label={label}
      title={compact ? label : undefined}
      className={cn(
        "flex h-8 max-w-48 shrink-0 items-center gap-2 rounded-lg border border-success/40 bg-success/10 text-sm text-foreground transition-colors duration-(--transition-fast) hover:bg-success/20 disabled:pointer-events-none",
        compact ? "w-8 justify-center px-0" : "px-3",
      )}
    >
      <Icon className={cn("size-4 shrink-0 text-success", status === "downloading" && "animate-spin")} aria-hidden />
      {compact ? null : <span className="min-w-0 flex-1 truncate text-start">{label}</span>}
    </button>
  );
}

function PrimaryNav({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.workspace")} className="flex shrink-0 items-center gap-0.5">
      {headerNavigation.map((item) => {
        const Icon = item.icon;
        const label = t(item.labelKey);
        return (
          <NavLink
            key={item.id}
            to={item.route}
            end={item.route === "/"}
            title={compact ? label : undefined}
            aria-label={compact ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex h-8 items-center gap-2 rounded-lg text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "w-8 justify-center px-0" : "px-2.5",
                isActive ? "menubar-active font-medium text-foreground" : "text-foreground/80 hover:bg-(--hover-bg) hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} aria-hidden />
                {compact ? null : <span className="whitespace-nowrap">{label}</span>}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function ToolsMenu({ openId, onOpenChange, iconOnly }: { openId: string | null; onOpenChange: (id: string | null) => void; iconOnly: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [allOpen, setAllOpen] = useState(false);
  const close = () => onOpenChange(null);
  const active = location.pathname.startsWith("/tools");

  return (
    <>
      <HeaderMenu id="tools" label={t("nav.tools")} icon={iconOnly ? Wrench : undefined} iconOnly={iconOnly} active={active} openId={openId} onOpenChange={onOpenChange} panelClassName="w-[46rem] p-3">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
          {TOOL_MENU_COLUMNS.map((column) => (
            <div key={column.join("-")} className="flex min-w-0 flex-col gap-3">
              {column.map((group) => {
                const items = menuItemsForGroup(group);
                if (items.length === 0) return null;
                const GroupIcon = toolGroupIcons[group];
                return (
                  <section key={group} data-tone={group} className="min-w-0">
                    <p className="flex h-8 items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      <GroupIcon className="size-3.5 text-(--tone)" aria-hidden />
                      <span className="truncate">{t(`tools.grid.groups.${group}`)}</span>
                    </p>
                    <div className="space-y-px">
                      {items.map((item) => (
                        <MenuLink key={item.id} icon={item.icon} label={t(item.labelKey)} route={item.route} tone={group} onSelect={close} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
        <MenuSeparator />
        <div className="grid grid-cols-2 gap-x-4">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              setAllOpen(true);
            }}
            className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LayoutGrid className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-start">{t("home.showAll")}</span>
            <span className="font-mono text-[11px]">{toolShortcuts.length}</span>
          </button>
          <MenuLink icon={Search} label={t("nav.folderSearch")} route="/search" onSelect={close} />
        </div>
      </HeaderMenu>
      <Dialog open={allOpen} onClose={() => setAllOpen(false)} title={t("home.catalog.title")} size="xl">
        <ToolBrowser grouped onSelect={() => setAllOpen(false)} />
      </Dialog>
    </>
  );
}

function HelpMenu({ openId, onOpenChange, iconOnly }: { openId: string | null; onOpenChange: (id: string | null) => void; iconOnly: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const close = () => onOpenChange(null);

  return (
    <HeaderMenu id="help" label={t("nav.help")} icon={iconOnly ? CircleHelp : undefined} iconOnly={iconOnly} active={location.pathname.startsWith("/about")} openId={openId} onOpenChange={onOpenChange} panelClassName="w-64">
      <MenuLink icon={Keyboard} label={t("about.tabs.shortcuts")} route="/about?tab=shortcuts" onSelect={close} />
      <MenuLink icon={ShieldCheck} label={t("about.tabs.privacy")} route="/about?tab=privacy" onSelect={close} />
      <MenuSeparator />
      <MenuLink icon={Bug} label={t("about.reportBug")} onClick={() => useReportStore.getState().openDialog({ category: "bug" })} onSelect={close} />
      <MenuLink icon={Lightbulb} label={t("about.suggestFeature")} onClick={() => useReportStore.getState().openDialog({ category: "idea" })} onSelect={close} />
      <MenuLink icon={FolderOpen} label={t("app.openLogDir")} onClick={() => void invoke("open_log_dir")} onSelect={close} />
      <MenuSeparator />
      <MenuLink icon={RefreshCw} label={t("about.actions.checkUpdates")} route="/settings?section=updates" onSelect={close} />
      <MenuLink icon={Info} label={t("nav.about")} route="/about" onSelect={close} />
    </HeaderMenu>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const dark = isDarkTheme(theme);
  const next = dark ? "light" : "dark";
  const label = `${t("common.theme")}: ${t(`theme.${next}`)}`;
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={label}
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:bg-(--hover-bg) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function LanguageMenu({ openId, onOpenChange }: { openId: string | null; onOpenChange: (id: string | null) => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
  const close = () => onOpenChange(null);
  return (
    <HeaderMenu id="language" icon={Languages} label={locale.split("-")[0].toUpperCase()} menuLabel={t("common.language")} active={false} openId={openId} onOpenChange={onOpenChange} panelClassName="w-52">
      {LOCALES.map((item) => (
        <MenuLink key={item.code} icon={item.code === locale ? Check : undefined} label={item.nativeName} active={item.code === locale} onClick={() => setLocale(item.code as Locale)} onSelect={close} />
      ))}
    </HeaderMenu>
  );
}

export function TopBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const { pickAndOpen } = useOpenPdf();
  const busy = useOpenStore((state) => state.busy);
  const openPalette = usePaletteStore((state) => state.open);
  const activeDocument = useActiveOpenDocument();
  const barRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const uiScale = usePreferencesStore((state) => state.uiScale);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const title = activeDocument ? `${activeDocument.fileName} — vivePDF` : "vivePDF";
    getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [activeDocument]);

  const layoutWidth = width / rootFontScale(uiScale, uiZoom);
  const compactNav = layoutWidth < COMPACT_NAV_BREAKPOINT;
  const compactSearch = layoutWidth < COMPACT_SEARCH_BREAKPOINT;
  const compactActions = layoutWidth < COMPACT_ACTIONS_BREAKPOINT;
  const hideQuickToggles = layoutWidth < HIDE_QUICK_TOGGLES_BREAKPOINT;
  const iconMenus = layoutWidth < ICON_MENUS_BREAKPOINT;
  const hidePrimaryNav = layoutWidth < HIDE_PRIMARY_NAV_BREAKPOINT;
  const settingsActive = location.pathname.startsWith("/settings");

  return (
    <header ref={barRef} data-tauri-drag-region className="glass-flat flex h-topbar select-none items-center gap-1.5 border-b ps-3 pe-0">
      <Link to="/" aria-label={t("app.name")} className="me-2 flex h-8 shrink-0 items-center gap-2 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Logo size={22} />
        {compactNav ? null : (
          <span className="text-sm font-semibold tracking-tight">
            vive<span className="text-primary">PDF</span>
          </span>
        )}
      </Link>
      {hidePrimaryNav ? null : <PrimaryNav compact={compactNav} />}
      <ToolsMenu openId={openMenu} onOpenChange={setOpenMenu} iconOnly={iconMenus} />
      <HelpMenu openId={openMenu} onOpenChange={setOpenMenu} iconOnly={iconMenus} />
      <span data-tauri-drag-region className="h-full min-w-4 flex-1" />
      <UpdateBadge compact={compactActions} />
      <button
        type="button"
        onClick={openPalette}
        title={compactSearch ? t("palette.placeholder") : undefined}
        aria-label={compactSearch ? t("palette.placeholder") : undefined}
        className={cn("field-inline flex h-8 shrink-0 items-center gap-2 rounded-full text-sm text-muted-foreground", compactSearch ? "w-8 justify-center px-0" : "w-60 px-3")}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        {compactSearch ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-start">{t("palette.placeholder")}</span>
            <kbd className="shrink-0 rounded-md border bg-card/70 px-1.5 font-mono text-[11px]">Ctrl K</kbd>
          </>
        )}
      </button>
      {hideQuickToggles ? null : (
        <>
          <ThemeToggle />
          <LanguageMenu openId={openMenu} onOpenChange={setOpenMenu} />
        </>
      )}
      <NavLink
        to="/settings"
        title={t("nav.settings")}
        aria-label={t("nav.settings")}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
          settingsActive ? "menubar-active text-primary" : "text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground",
        )}
      >
        <Settings className="size-4" aria-hidden />
      </NavLink>
      <Button
        size="sm"
        variant="primary"
        icon={<FolderOpen className="size-4" aria-hidden />}
        loading={busy}
        onClick={() => void pickAndOpen()}
        aria-label={compactActions ? t("common.openPdf") : undefined}
        title={compactActions ? t("common.openPdf") : undefined}
        className={cn("ms-1 shrink-0", compactActions && "w-8 px-0")}
      >
        {compactActions ? null : t("common.openPdf")}
      </Button>
      <WindowControls />
    </header>
  );
}
