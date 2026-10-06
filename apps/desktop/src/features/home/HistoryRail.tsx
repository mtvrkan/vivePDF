import { useEffect, useState } from "react";
import { FolderSearch, History, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { findNavItemByRoute } from "@/app/navigation";
import { Button } from "@/components/shared/Button";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { basenameOf } from "@/shared/lib/paths";
import { revealPath, RevealError } from "@/shared/lib/reveal";
import { deleteFile, isPdfPath } from "@/shared/rpc/files";
import { toRpcError } from "@/shared/rpc/client";
import { useHistoryStore, type HistoryEntry } from "@/shared/store/historyStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { describeError } from "@/shared/lib/errorMessage";
import { bySize, listPadding, type HomeSize } from "./homeLayout";


export function HistoryRail({ size = "medium" }: { size?: HomeSize }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const items = useHistoryStore((state) => state.items);
  const remove = useHistoryStore((state) => state.remove);
  const clearStore = useHistoryStore((state) => state.clear);
  const restoreHistory = useHistoryStore((state) => state.restore);
  const toast = useToastStore((state) => state.push);
  const clearHistory = () => {
    const snapshot = items;
    clearStore();
    toast("info", t("home.history.cleared"), { label: t("common.undo"), onClick: () => restoreHistory(snapshot) });
  };
  const { openPath } = useOpenPdf();
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const menu = useContextMenu();
  const [menuEntry, setMenuEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    const paths = items.map((entry) => entry.outputs[0] ?? "");
    if (paths.length === 0) return;
    let cancelled = false;
    invoke<boolean[]>("path_exists", { paths })
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, boolean> = {};
        paths.forEach((path, index) => {
          next[path] = !results[index];
        });
        setMissing(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [items]);

  const handleReveal = async (path: string) => {
    try {
      await revealPath(path);
    } catch (error) {
      const reasonKey = error instanceof RevealError ? error.reasonKey : "errors.revealFailed";
      toast("error", t(reasonKey));
    }
  };

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      for (const output of pending.outputs) await deleteFile(output);
      remove(pending.id);
      toast("success", t("home.history.deleted"));
      setPending(null);
    } catch (error) {
      const rpcError = toRpcError(error);
      toast("error", describeError(t, rpcError));
    } finally {
      setDeleting(false);
    }
  };

  const available = items.filter((entry) => missing[entry.outputs[0] ?? ""] !== true);
  const shown = available.slice(0, bySize(size, 3, 6, 12));

  if (items.length === 0) return null;

  return (
    <section className={`glass rounded-2xl ${listPadding(size)}`}>
      <div className="flex h-9 items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("home.history.title")}</span>
        <button type="button" onClick={clearHistory} className="flex min-h-6 items-center rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
          {t("home.clearRecent")}
        </button>
      </div>
      {shown.length === 0 ? <p className="px-2 pb-2 text-xs text-muted-foreground">{t("home.history.allMissing")}</p> : null}
      <ul className="space-y-1">
        {shown.map((entry) => {
          const item = findNavItemByRoute(entry.tool);
          const first = entry.outputs[0] ?? "";
          const isMissing = missing[first] === true;
          return (
            <li key={entry.id} className={`nav-glass group flex items-center gap-1 rounded-xl px-2 py-1.5 ${isMissing ? "opacity-50" : ""}`}>
              <button
                type="button"
                disabled={isMissing}
                onClick={() => (isPdfPath(first) ? void openPath(first) : void handleReveal(first))}
                onContextMenu={(event) => {
                  setMenuEntry(entry);
                  menu.open(event);
                }}
                title={isMissing ? t("home.history.missing") : entry.outputs.join("\n")}
                className="flex min-w-0 flex-1 items-center gap-3 text-start disabled:cursor-not-allowed"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                  <History className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span title={entry.outputs.length > 1 ? t("home.history.outputs", { count: entry.outputs.length }) : basenameOf(first)} className="block truncate text-sm">{entry.outputs.length > 1 ? t("home.history.outputs", { count: entry.outputs.length }) : basenameOf(first)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {isMissing ? t("home.history.missing") : item ? t(item.labelKey) : entry.tool} · {new Date(entry.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--transition-fast) focus-within:opacity-100 group-hover:opacity-100">
                {isMissing ? (
                  <IconButton icon={Trash2} label={t("home.history.removeFromList")} onClick={() => remove(entry.id)} />
                ) : (
                  <>
                    <IconButton icon={FolderSearch} label={t("tools.reveal")} onClick={() => void handleReveal(first)} />
                    <IconButton icon={Trash2} label={t("home.history.delete")} onClick={() => setPending(entry)} />
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Dialog
        open={pending !== null}
        title={t("home.history.confirmTitle")}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button onClick={() => setPending(null)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} loading={deleting}>
              {t("home.history.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("home.history.confirmDescription", { count: pending?.outputs.length ?? 0 })}</p>
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto font-mono text-xs">
          {pending?.outputs.map((output) => (
            <li key={output} className="truncate" title={output}>
              {output}
            </li>
          ))}
        </ul>
      </Dialog>
      {menu.anchor && menuEntry
        ? (() => {
            const first = menuEntry.outputs[0] ?? "";
            const items: ContextMenuItem[] = [
              { type: "item", id: "open", label: t("home.history.open"), onSelect: () => (isPdfPath(first) ? void openPath(first) : void handleReveal(first)) },
              { type: "item", id: "show-in-folder", label: t("tools.reveal"), onSelect: () => void handleReveal(first) },
              { type: "item", id: "copy-path", label: t("viewer.context.copyPath"), onSelect: () => void navigator.clipboard.writeText(first) },
              { type: "separator", id: "sep-remove" },
              { type: "item", id: "remove-from-list", label: t("home.history.removeFromList"), onSelect: () => remove(menuEntry.id) },
            ];
            return <ContextMenu anchor={menu.anchor} items={items} label={t("home.history.title")} onClose={menu.close} />;
          })()
        : null}
    </section>
  );
}
