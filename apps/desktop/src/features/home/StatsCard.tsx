import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { findNavItemByRoute } from "@/app/navigation";
import { useEngineStore } from "@/shared/store/engineStore";
import { useHistoryStore } from "@/shared/store/historyStore";
import { usePaletteStore } from "@/shared/store/paletteStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import { useWatchStore } from "@/shared/store/watchStore";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { cn } from "@/shared/lib/cn";
import { listPadding, type HomeSize } from "./homeLayout";
import { FULLSCREEN_SHORTCUT, shortcutLabel } from "@/shared/lib/platform";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Health = "ok" | "warn" | "off";

function StatusDot({ health }: { health: Health }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", health === "ok" && "bg-success", health === "warn" && "animate-pulse bg-warning", health === "off" && "bg-muted-foreground/50")} />;
}

function OverviewRow({ label, value, health, onClick, mono = true }: { label: string; value: string; health?: Health; onClick?: () => void; mono?: boolean }) {
  const content = (
    <>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className={cn("flex shrink-0 items-center gap-1.5 text-foreground", mono ? "font-mono text-xs tabular-nums" : "text-sm")}>
        {health ? <StatusDot health={health} /> : null}
        {value}
      </span>
    </>
  );
  if (!onClick) return <div className="flex h-8 items-center justify-between gap-3 px-2 text-sm">{content}</div>;
  return (
    <button type="button" onClick={onClick} className="nav-glass flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </button>
  );
}

function ShortcutRow({ label, keys, onClick }: { label: string; keys: string; onClick?: () => void }) {
  const content = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <kbd className="glass-chip shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-foreground">{shortcutLabel(keys)}</kbd>
    </>
  );
  if (!onClick) return <div className="flex h-8 items-center justify-between gap-3 px-2 text-sm text-muted-foreground">{content}</div>;
  return (
    <button type="button" onClick={onClick} className="nav-glass flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2 text-start text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </button>
  );
}

export function StatsCard({ size = "medium" }: { size?: HomeSize }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const backParam = `&from=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  const engineStatus = useEngineStore((state) => state.status);
  const engineInfo = useEngineStore((state) => state.info);
  const toolsStatus = useToolsStatusStore((state) => state.status);
  const tools = useToolsStatusStore((state) => state.tools);
  const refreshTools = useToolsStatusStore((state) => state.refresh);
  const history = useHistoryStore((state) => state.items);
  const rules = useWatchStore((state) => state.rules);
  const openPalette = usePaletteStore((state) => state.open);
  const { pickAndOpen } = useOpenPdf();

  useEffect(() => {
    if (toolsStatus === "idle") void refreshTools();
  }, [toolsStatus, refreshTools]);

  const weekCount = useMemo(() => {
    const since = Date.now() - WEEK_MS;
    return history.filter((entry) => entry.at >= since).length;
  }, [history]);

  const topTool = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of history) counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    for (const [tool, count] of counts) {
      if (count > bestCount) {
        best = tool;
        bestCount = count;
      }
    }
    if (!best) return null;
    const item = findNavItemByRoute(best);
    return { route: best, label: item ? t(item.labelKey) : best };
  }, [history, t]);

  const enabledRules = rules.filter((rule) => rule.enabled).length;
  const ocrLanguages = tools?.ocrLanguages.length ?? 0;
  const engineHealth: Health = engineStatus === "success" ? "ok" : engineStatus === "error" ? "off" : "warn";
  const toolsFailed = toolsStatus === "error";
  const toolsHealth = (ready: boolean): Health => (toolsStatus === "success" ? (ready ? "ok" : "off") : toolsFailed ? "off" : "warn");
  const toolsValue = (ready: string): string => (toolsStatus === "success" ? ready : toolsFailed ? t("home.stats.checkFailed") : "…");

  return (
    <section className={`glass rounded-2xl ${listPadding(size)}`}>
      <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.stats.title")}</p>
      <div className="space-y-px">
        <OverviewRow label={t("home.stats.week")} value={String(weekCount)} />
        {topTool ? <OverviewRow label={t("home.stats.topTool")} value={topTool.label} mono={false} onClick={() => void navigate(topTool.route)} /> : null}
        <OverviewRow
          label={t("home.stats.ocr")}
          value={toolsValue(ocrLanguages > 0 ? t("home.stats.languages", { count: ocrLanguages }) : t("home.stats.notInstalled"))}
          health={toolsHealth(ocrLanguages > 0)}
          onClick={() => void navigate(`/settings?section=tools${backParam}`)}
        />
        <OverviewRow
          label={t("home.stats.office")}
          value={toolsValue(tools?.libreoffice ? t("home.stats.ready") : t("home.stats.notInstalled"))}
          health={toolsHealth(Boolean(tools?.libreoffice))}
          onClick={() => void navigate(`/settings?section=tools${backParam}`)}
        />
        {toolsFailed ? (
          <div className="flex h-8 items-center justify-end px-2">
            <button type="button" onClick={() => void refreshTools()} className="flex min-h-6 items-center rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {t("common.retry")}
            </button>
          </div>
        ) : null}
        <OverviewRow
          label={t("home.stats.watch")}
          value={rules.length > 0 ? t("home.stats.activeOf", { active: enabledRules, total: rules.length }) : "—"}
          health={rules.length > 0 ? (enabledRules > 0 ? "ok" : "off") : undefined}
          onClick={() => void navigate("/tools/watch")}
        />
        <OverviewRow label={t("home.stats.engine")} value={engineInfo?.version ?? "—"} health={engineHealth} onClick={() => void navigate("/about")} />
      </div>
      {size === "small" ? null : (
      <div className="mt-3 border-t pt-3">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("emptyDoc.shortcuts")}</p>
        <div className="space-y-px">
          <ShortcutRow label={t("common.openPdf")} keys="Ctrl O" onClick={() => void pickAndOpen()} />
          <ShortcutRow label={t("emptyDoc.palette")} keys="Ctrl K" onClick={openPalette} />
          <ShortcutRow label={t("about.shortcuts.items.search")} keys="Ctrl F" />
          <ShortcutRow label={t("about.shortcuts.items.print")} keys="Ctrl P" />
          {size === "large" ? (
            <>
              <ShortcutRow label={t("about.shortcuts.items.closeDocument")} keys="Ctrl W" />
              <ShortcutRow label={t("about.shortcuts.items.fullscreen")} keys={FULLSCREEN_SHORTCUT} />
            </>
          ) : null}
        </div>
      </div>
      )}
    </section>
  );
}
