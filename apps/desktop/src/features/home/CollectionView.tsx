import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, FileText, FolderOpen, FolderSearch, Minus, Pencil, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { GROUP_COLORS, GROUP_TONES } from "@/features/viewer/tabGroups";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { cn } from "@/shared/lib/cn";
import { basenameOf, dirnameOf } from "@/shared/lib/paths";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { COLLECTION_SORTS, matchingPaths, sortedPaths, type CollectionSort } from "./collectionFiles";
import { useCollectionsStore } from "./collectionsStore";
import { useOpenCollection } from "./useOpenCollection";

function useMissingPaths(paths: string[]): Set<string> {
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const key = paths.join("\n");

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    let cancelled = false;
    invoke<boolean[]>("path_exists", { paths: list })
      .then((results) => {
        if (!cancelled) setMissing(new Set(list.filter((_, index) => !results[index])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);

  return missing;
}

function SelectBox({ state, label, onClick }: { state: boolean | "mixed"; label: string; onClick: () => void }) {
  const on = state !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-transparent hover:border-primary/60",
      )}
    >
      {state === "mixed" ? <Minus className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
    </button>
  );
}

export function CollectionView({ collectionId, onClose, onEdit }: { collectionId: string; onClose: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const collection = useCollectionsStore((state) => state.collections.find((item) => item.id === collectionId));
  const recolor = useCollectionsStore((state) => state.recolor);
  const removePath = useCollectionsStore((state) => state.removePath);
  const removePaths = useCollectionsStore((state) => state.removePaths);
  const restore = useCollectionsStore((state) => state.restore);
  const toast = useToastStore((state) => state.push);
  const { openPath } = useOpenPdf();
  const openCollection = useOpenCollection();
  const [opening, setOpening] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CollectionSort>("collection");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const paths = useMemo(() => collection?.paths ?? [], [collection]);
  const missing = useMissingPaths(paths);
  const ordered = useMemo(() => sortedPaths(paths, sort, locale), [paths, sort, locale]);
  const shown = useMemo(() => matchingPaths(ordered, query, locale), [ordered, query, locale]);
  const selected = ordered.filter((path) => picked.has(path));
  const shownSelected = shown.filter((path) => picked.has(path)).length;

  if (!collection) return null;

  const openFiles = async (files: string[]) => {
    setOpening(true);
    try {
      await openCollection({ ...collection, paths: files });
      onClose();
    } finally {
      setOpening(false);
    }
  };

  const openOne = (path: string) => {
    onClose();
    void openPath(path);
  };

  const reveal = async (path: string) => {
    try {
      await revealPath(path);
    } catch (error) {
      toast("error", t(error instanceof RevealError ? error.reasonKey : "errors.revealFailed"));
    }
  };

  const toggle = (path: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleShown = () =>
    setPicked((current) => {
      const next = new Set(current);
      const all = shown.every((path) => next.has(path));
      for (const path of shown) {
        if (all) next.delete(path);
        else next.add(path);
      }
      return next;
    });

  const removeSelected = () => {
    const snapshot = useCollectionsStore.getState().collections;
    removePaths(collection.id, selected);
    setPicked(new Set());
    toast("info", t("home.collections.removedFiles", { count: selected.length, name: collection.name }), { label: t("common.undo"), onClick: () => restore(snapshot) });
  };

  return (
    <Dialog
      open
      size="lg"
      title={collection.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
            {t("home.collections.edit")}
          </Button>
          <Button variant="primary" icon={<FolderOpen className="size-4" aria-hidden />} loading={opening} disabled={paths.length === 0} onClick={() => void openFiles(ordered)}>
            {t("home.collections.open")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="collection-view">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{t("home.collections.color")}</p>
          <div role="radiogroup" aria-label={t("home.collections.color")} className="flex flex-wrap gap-1.5 p-1">
            {GROUP_COLORS.map((color) => {
              const isCurrent = collection.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={isCurrent}
                  aria-label={t(`viewer.tabGroups.colors.${color}`)}
                  title={t(`viewer.tabGroups.colors.${color}`)}
                  onClick={() => recolor(collection.id, color)}
                  style={{ background: GROUP_TONES[color] } as CSSProperties}
                  className={cn("flex size-6 items-center justify-center rounded-full text-white outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-ring", isCurrent && "ring-2 ring-foreground/70")}
                >
                  {isCurrent ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("home.collections.files", { count: paths.length })}</p>
          {paths.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="field flex h-8 min-w-48 flex-1 items-center gap-2 rounded-lg px-2.5 text-sm">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("home.collections.search")}
                  aria-label={t("home.collections.search")}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label={t("common.close")} className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </label>
              <span className="w-44">
                <Select
                  size="sm"
                  value={sort}
                  options={COLLECTION_SORTS.map((value) => ({ value, label: t(`home.collections.sorts.${value}`) }))}
                  onChange={(value) => setSort(value as CollectionSort)}
                  ariaLabel={t("home.collections.sort")}
                />
              </span>
            </div>
          ) : null}
          {shown.length > 0 && paths.length > 1 ? (
            <div className="flex min-h-8 flex-wrap items-center gap-2 px-2.5">
              <SelectBox state={shownSelected === 0 ? false : shownSelected === shown.length ? true : "mixed"} label={t("home.collections.selectAll")} onClick={toggleShown} />
              <span className="flex-1 text-xs text-muted-foreground" role="status">
                {selected.length > 0 ? t("home.collections.selected", { count: selected.length }) : t("home.collections.selectAll")}
              </span>
              {selected.length > 0 ? (
                <>
                  <IconButton icon={X} label={t("home.collections.clearSelection")} onClick={() => setPicked(new Set())} />
                  <Button size="sm" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={removeSelected}>
                    {t("home.collections.removeSelected")}
                  </Button>
                  <Button size="sm" variant="primary" icon={<FolderOpen className="size-3.5" aria-hidden />} loading={opening} onClick={() => void openFiles(selected)}>
                    {t("home.collections.openSelected")}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {paths.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t("home.collections.noFiles")}</p>
          ) : shown.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t("home.collections.noMatches", { query: query.trim() })}</p>
          ) : (
            <ul className="-mx-1 flex max-h-80 flex-col gap-1 overflow-auto p-1">
              {shown.map((path) => {
                const name = basenameOf(path);
                const isMissing = missing.has(path);
                const isPicked = picked.has(path);
                return (
                  <li
                    key={path}
                    data-collection-file={name}
                    className={cn("flex items-center gap-1 rounded-lg ps-2.5 pe-1 transition-colors duration-(--transition-fast)", isPicked ? "bg-primary/10" : "bg-secondary/50 hover:bg-secondary")}
                  >
                    {paths.length > 1 ? <SelectBox state={isPicked} label={t("home.collections.selectFile", { name })} onClick={() => toggle(path)} /> : null}
                    <button
                      type="button"
                      disabled={isMissing}
                      onClick={() => openOne(path)}
                      title={path}
                      aria-label={t("home.collections.openFile", { name })}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isMissing ? <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{isMissing ? t("home.collections.missing") : dirnameOf(path)}</span>
                      </span>
                    </button>
                    {isMissing ? null : <IconButton icon={FolderSearch} label={t("tools.reveal")} onClick={() => void reveal(path)} />}
                    <IconButton icon={X} label={`${t("home.collections.removeFile")}: ${name}`} onClick={() => removePath(collection.id, path)} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
