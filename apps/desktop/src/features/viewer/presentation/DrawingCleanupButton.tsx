import { BrushCleaning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { CLEAR_PAGE_SHORTCUT, clearWithUndo } from "./drawingCleanup";

export function TemporaryDrawingCleanup({ pageIndex }: { pageIndex: number }) {
  const pageCount = usePresentationStore((state) => state.visibleStrokeCount(pageIndex));
  const totalCount = usePresentationStore((state) => state.totalStrokeCount());
  return (
    <DrawingCleanupButton
      pageCount={pageCount}
      totalCount={totalCount}
      onClearPage={() => clearWithUndo(() => usePresentationStore.getState().clearVisible(pageIndex))}
      onClearAll={() => clearWithUndo(() => usePresentationStore.getState().clearAllDrawings())}
    />
  );
}

export function DrawingCleanupButton({
  pageCount,
  totalCount,
  onClearPage,
  onClearAll,
}: {
  pageCount: number;
  totalCount: number;
  onClearPage: () => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation();
  const menu = useContextMenu();
  const items: ContextMenuItem[] = [
    {
      type: "item",
      id: "clear-page",
      label: t("presentation.cleanup.page", { count: pageCount }),
      shortcut: CLEAR_PAGE_SHORTCUT,
      disabled: pageCount === 0,
      onSelect: onClearPage,
    },
    { type: "item", id: "clear-all", label: t("presentation.cleanup.all", { count: totalCount }), disabled: totalCount === 0, onSelect: onClearAll },
  ];

  return (
    <>
      <IconButton
        icon={BrushCleaning}
        label={t("presentation.cleanup.title")}
        disabled={totalCount === 0}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        data-testid="presentation-cleanup"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          menu.openAt({ x: rect.left, y: rect.top });
        }}
      />
      {menu.anchor ? <ContextMenu anchor={menu.anchor} items={items} label={t("presentation.cleanup.title")} onClose={menu.close} /> : null}
    </>
  );
}
