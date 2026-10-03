import { useState, type CSSProperties } from "react";
import { FilePlus2, Files, FolderOpen, Library, MoreHorizontal, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { OPEN_CONVERTIBLE_EXTENSIONS, sessionPathOf } from "@/features/viewer/convertedDocuments";
import { GROUP_COLORS, GROUP_TONES } from "@/features/viewer/tabGroups";
import { basenameOf, pathKey } from "@/shared/lib/paths";
import { inTabOrder, useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { COLLECTION_FILES_MAX, COLLECTION_NAME_MAX, useCollectionsStore, type Collection } from "./collectionsStore";
import { bySize, type HomeSize } from "./homeLayout";
import { useOpenCollection } from "./useOpenCollection";


type Draft = { id: string | null; name: string; paths: string[] };

function toneStyle(collection: Collection): CSSProperties {
  return { ["--tone" as string]: GROUP_TONES[collection.color] };
}

function openDocumentPaths(): string[] {
  const { documents, order } = useDocumentStore.getState();
  return inTabOrder(Object.values(documents), order).map((document) => sessionPathOf(document.path));
}

function mergePaths(current: string[], added: string[]): string[] {
  const keys = new Set(current.map(pathKey));
  return [...current, ...added.filter((path) => !keys.has(pathKey(path)))].slice(0, COLLECTION_FILES_MAX);
}

function CollectionDialog({ draft, onChange, onClose }: { draft: Draft; onChange: (draft: Draft) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCollectionsStore((state) => state.create);
  const rename = useCollectionsStore((state) => state.rename);
  const restore = useCollectionsStore((state) => state.restore);
  const openCount = useDocumentStore((state) => state.order.length);
  const valid = draft.name.trim().length > 0 && draft.paths.length > 0;

  const pickFiles = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: t("viewer.converted.allSupported"), extensions: ["pdf", ...OPEN_CONVERTIBLE_EXTENSIONS] }],
    });
    if (!selected) return;
    onChange({ ...draft, paths: mergePaths(draft.paths, Array.isArray(selected) ? selected : [selected]) });
  };

  const submit = () => {
    if (!valid) return;
    if (draft.id === null) {
      create(draft.name, draft.paths);
    } else {
      rename(draft.id, draft.name);
      const collections = useCollectionsStore.getState().collections;
      restore(collections.map((collection) => (collection.id === draft.id ? { ...collection, paths: draft.paths } : collection)));
    }
    onClose();
  };

  return (
    <Dialog
      open
      title={t(draft.id === null ? "home.collections.createTitle" : "home.collections.editTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t("home.collections.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("home.collections.name")}
          <input
            autoFocus
            value={draft.name}
            maxLength={COLLECTION_NAME_MAX}
            placeholder={t("home.collections.namePlaceholder")}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="field h-9 rounded-lg px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t("home.collections.files", { count: draft.paths.length })}</p>
          {draft.paths.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t("home.collections.noFiles")}</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-auto">
              {draft.paths.map((path) => (
                <li key={path} className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-xs">
                  <Files className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {basenameOf(path)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...draft, paths: draft.paths.filter((entry) => entry !== path) })}
                    aria-label={`${t("home.collections.removeFile")}: ${basenameOf(path)}`}
                    className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" icon={<FilePlus2 className="size-4" aria-hidden />} disabled={draft.paths.length >= COLLECTION_FILES_MAX} onClick={() => void pickFiles()}>
              {t("home.collections.addFiles")}
            </Button>
            {openCount > 0 ? (
              <Button type="button" size="sm" variant="ghost" icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => onChange({ ...draft, paths: mergePaths(draft.paths, openDocumentPaths()) })}>
                {t("home.collections.addOpen", { count: openCount })}
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function CollectionCard({ collection, onEdit, preview }: { collection: Collection; onEdit: () => void; preview: number }) {
  const { t } = useTranslation();
  const openCollection = useOpenCollection();
  const recolor = useCollectionsStore((state) => state.recolor);
  const remove = useCollectionsStore((state) => state.remove);
  const restore = useCollectionsStore((state) => state.restore);
  const toast = useToastStore((state) => state.push);
  const menu = useContextMenu();
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    try {
      await openCollection(collection);
    } finally {
      setOpening(false);
    }
  };

  const removeCollection = () => {
    const snapshot = useCollectionsStore.getState().collections;
    remove(collection.id);
    toast("info", t("home.collections.removed", { name: collection.name }), { label: t("common.undo"), onClick: () => restore(snapshot) });
  };

  const items: ContextMenuItem[] = [
    { type: "item", id: "edit", label: t("home.collections.edit"), onSelect: onEdit },
    {
      type: "submenu",
      id: "color",
      label: t("viewer.tabGroups.color"),
      items: GROUP_COLORS.map((color) => ({ type: "item" as const, id: `color-${color}`, label: t(`viewer.tabGroups.colors.${color}`), checked: collection.color === color, onSelect: () => recolor(collection.id, color) })),
    },
    { type: "separator", id: "sep" },
    { type: "item", id: "remove", label: t("home.collections.remove"), onSelect: removeCollection },
  ];

  return (
    <li data-collection={collection.name} style={toneStyle(collection)} className="glass-flat relative flex flex-col overflow-hidden rounded-xl border border-(--glass-border)">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-(--tone)" />
      <div className="flex items-start gap-3 p-3 pt-4" onContextMenu={menu.open}>
        <span className="tone-tile flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Library className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={collection.name}>
            {collection.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("home.collections.files", { count: collection.paths.length })}</p>
        </div>
        <IconButton icon={MoreHorizontal} label={t("home.collections.actions", { name: collection.name })} aria-haspopup="menu" onClick={(event) => menu.open(event)} />
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 px-3 pb-2 text-xs text-muted-foreground">
        {collection.paths.slice(0, preview).map((path) => (
          <li key={path} className="truncate" title={path}>
            {basenameOf(path)}
          </li>
        ))}
        {preview > 0 && collection.paths.length > preview ? <li>{t("home.collections.more", { count: collection.paths.length - preview })}</li> : null}
      </ul>
      <div className="px-3 pb-3">
        <Button size="sm" className="w-full" loading={opening} disabled={collection.paths.length === 0} onClick={() => void open()}>
          {t("home.collections.open")}
        </Button>
      </div>
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={items} label={collection.name} onClose={menu.close} /> : null}
    </li>
  );
}

export function CollectionsSection({ size = "medium" }: { size?: HomeSize }) {
  const { t } = useTranslation();
  const collections = useCollectionsStore((state) => state.collections);
  const [draft, setDraft] = useState<Draft | null>(null);
  const startCreating = () => setDraft({ id: null, name: "", paths: openDocumentPaths() });

  return (
    <section className="glass @container rounded-2xl p-5" aria-labelledby="home-collections-title">
      <div className="flex items-center justify-between gap-3">
        <p id="home-collections-title" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("home.collections.title")}
        </p>
        {collections.length > 0 ? (
          <button type="button" onClick={startCreating} className="flex min-h-6 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Plus className="size-3.5" aria-hidden />
            {t("home.collections.new")}
          </button>
        ) : null}
      </div>

      {collections.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <span className="tone-tile flex size-11 items-center justify-center rounded-2xl">
            <Library className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">{t("home.collections.emptyTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("home.collections.emptyDescription")}</p>
          </div>
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={startCreating}>
            {t("home.collections.create")}
          </Button>
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
          {collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} preview={bySize(size, 0, 3, 6)} onEdit={() => setDraft({ id: collection.id, name: collection.name, paths: collection.paths })} />
          ))}
        </ul>
      )}
      {draft ? <CollectionDialog draft={draft} onChange={setDraft} onClose={() => setDraft(null)} /> : null}
    </section>
  );
}
