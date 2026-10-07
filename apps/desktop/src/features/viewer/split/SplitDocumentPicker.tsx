import { useState } from "react";
import { ChevronDown, FileText, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useSplitViewStore, type SplitSecondary } from "@/shared/store/splitViewStore";
import { choosePdfPath, otherOpenDocuments } from "./splitTargets";

type SplitDocumentPickerProps = { primaryId: string; primaryPath: string; path: string; name: string; separate: boolean };

function knownPasswordOf(path: string): string | null {
  return Object.values(useDocumentStore.getState().documents).find((entry) => entry.path === path)?.password ?? null;
}

export function SplitDocumentPicker({ primaryId, primaryPath, path, name, separate }: SplitDocumentPickerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  useDocumentStore((state) => state.documents);
  useDocumentStore((state) => state.order);

  const show = (secondary: SplitSecondary | null) => useSplitViewStore.getState().setSecondary(primaryPath, secondary);
  const chooseFile = async () => {
    const chosen = await choosePdfPath();
    if (chosen) show({ path: chosen, password: knownPasswordOf(chosen) });
  };

  const others = anchor ? otherOpenDocuments(primaryId) : [];
  const items: ContextMenuItem[] = [
    { type: "item", id: "split-same", icon: FileText, label: t("viewer.split.sameDocument"), checked: !separate, onSelect: () => show(null) },
    ...(others.length > 0 ? [{ type: "separator" as const, id: "sep-split-open" }] : []),
    ...others.map((entry) => ({
      type: "item" as const,
      id: `split-doc-${entry.id}`,
      label: entry.fileName,
      checked: separate && entry.path === path,
      onSelect: () => show({ path: entry.path, password: entry.password }),
    })),
    { type: "separator", id: "sep-split-file" },
    { type: "item", id: "split-choose", icon: FolderOpen, label: t("viewer.split.chooseFile"), onSelect: () => void chooseFile() },
  ];

  return (
    <>
      <button
        type="button"
        className="nav-glass flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={name}
        aria-label={t("viewer.split.pickDocument", { name })}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        {...{ [MENU_LAYER]: "" }}
        onClick={(event) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <span className="min-w-0 truncate">{name}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {anchor ? <ContextMenu anchor={anchor} items={items} label={t("viewer.split.pickDocument", { name })} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
