import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, FileText, FolderOpen, FolderSearch, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { GROUP_COLORS, GROUP_TONES } from "@/features/viewer/tabGroups";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { cn } from "@/shared/lib/cn";
import { basenameOf, dirnameOf } from "@/shared/lib/paths";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { useToastStore } from "@/shared/store/toastStore";
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

export function CollectionView({ collectionId, onClose, onEdit }: { collectionId: string; onClose: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const collection = useCollectionsStore((state) => state.collections.find((item) => item.id === collectionId));
  const recolor = useCollectionsStore((state) => state.recolor);
  const removePath = useCollectionsStore((state) => state.removePath);
  const toast = useToastStore((state) => state.push);
  const { openPath } = useOpenPdf();
  const openCollection = useOpenCollection();
  const [opening, setOpening] = useState(false);
  const missing = useMissingPaths(collection?.paths ?? []);

  if (!collection) return null;

  const openAll = async () => {
    setOpening(true);
    try {
      await openCollection(collection);
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
          <Button variant="primary" icon={<FolderOpen className="size-4" aria-hidden />} loading={opening} disabled={collection.paths.length === 0} onClick={() => void openAll()}>
            {t("home.collections.open")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="collection-view">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{t("home.collections.color")}</p>
          <div role="radiogroup" aria-label={t("home.collections.color")} className="flex flex-wrap gap-1.5">
            {GROUP_COLORS.map((color) => {
              const selected = collection.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(`viewer.tabGroups.colors.${color}`)}
                  title={t(`viewer.tabGroups.colors.${color}`)}
                  onClick={() => recolor(collection.id, color)}
                  style={{ background: GROUP_TONES[color] } as CSSProperties}
                  className={cn("flex size-6 items-center justify-center rounded-full text-white outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-ring", selected && "ring-2 ring-foreground/70")}
                >
                  {selected ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t("home.collections.files", { count: collection.paths.length })}</p>
          {collection.paths.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t("home.collections.noFiles")}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
              {collection.paths.map((path) => {
                const name = basenameOf(path);
                const isMissing = missing.has(path);
                return (
                  <li key={path} data-collection-file={name} className="group flex items-center gap-1 rounded-lg bg-secondary/50 pe-1">
                    <button
                      type="button"
                      disabled={isMissing}
                      onClick={() => openOne(path)}
                      title={path}
                      aria-label={t("home.collections.openFile", { name })}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
