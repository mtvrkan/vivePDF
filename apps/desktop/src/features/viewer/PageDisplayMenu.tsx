import { useState } from "react";
import { BookOpen, Columns2, File, MoveHorizontal, MoveVertical, Palette, PlayCircle, SquareSplitHorizontal, SquareSplitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollStrategy } from "@embedpdf/plugin-scroll";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { SpreadMode, useSpread } from "@embedpdf/plugin-spread/react";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { PAGE_COLOR_SCHEMES } from "@/shared/lib/pageColors";
import { useAutoScrollStore } from "@/shared/store/autoScrollStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { scrollDirectionOf, usePageDisplayStore, type ScrollDirection } from "@/shared/store/pageDisplayStore";
import { choosePageColors, useReadingStore } from "@/shared/store/readingStore";
import { splitViewOf, useSplitViewStore, type SplitLayout } from "@/shared/store/splitViewStore";

export const AUTO_SCROLL_SHORTCUT = "Ctrl+Shift+H";

const SPREAD_ICONS = { [SpreadMode.None]: File, [SpreadMode.Odd]: Columns2, [SpreadMode.Even]: BookOpen };

export function PageDisplayMenu({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const { spreadMode, provides: spread } = useSpread(documentId);
  const { provides: scroll } = useScroll(documentId);
  const direction = usePageDisplayStore((state) => scrollDirectionOf(state, documentId));
  const autoScrolling = useAutoScrollStore((state) => state.running);
  const pageColors = useReadingStore((state) => state.pageColors);
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const splitLayout = useSplitViewStore((state) => splitViewOf(state, path)?.layout ?? null);
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);

  const setDirection = (next: ScrollDirection) => {
    scroll?.setScrollStrategy(next === "horizontal" ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical);
    usePageDisplayStore.getState().setScroll(documentId, next);
  };

  const spreadItem = (id: string, mode: SpreadMode, label: string): ContextMenuItem => ({
    type: "item",
    id,
    icon: SPREAD_ICONS[mode],
    label,
    checked: spreadMode === mode,
    onSelect: () => spread?.setSpreadMode(mode),
  });

  const splitItem = (id: string, layout: SplitLayout, label: string, icon: typeof SquareSplitHorizontal): ContextMenuItem => ({
    type: "item",
    id,
    icon,
    label,
    checked: splitLayout === layout,
    onSelect: () => {
      if (path) useSplitViewStore.getState().open(path, layout);
    },
  });

  const items: ContextMenuItem[] = [
    spreadItem("display-single", SpreadMode.None, t("viewer.pageDisplay.single")),
    spreadItem("display-two", SpreadMode.Odd, t("viewer.pageDisplay.twoPage")),
    spreadItem("display-cover", SpreadMode.Even, t("viewer.pageDisplay.twoPageCover")),
    { type: "separator", id: "sep-display-spread" },
    { type: "item", id: "scroll-vertical", icon: MoveVertical, label: t("viewer.pageDisplay.vertical"), checked: direction === "vertical", onSelect: () => setDirection("vertical") },
    { type: "item", id: "scroll-horizontal", icon: MoveHorizontal, label: t("viewer.pageDisplay.horizontal"), checked: direction === "horizontal", onSelect: () => setDirection("horizontal") },
    { type: "separator", id: "sep-display-scroll" },
    {
      type: "item",
      id: "auto-scroll",
      icon: PlayCircle,
      label: t("viewer.pageDisplay.autoScroll"),
      shortcut: AUTO_SCROLL_SHORTCUT,
      checked: autoScrolling,
      onSelect: () => useAutoScrollStore.getState().toggle(),
    },
    {
      type: "submenu",
      id: "split-view",
      icon: SquareSplitHorizontal,
      label: t("viewer.split.title"),
      disabled: !path,
      items: [
        {
          type: "item",
          id: "split-off",
          label: t("viewer.split.off"),
          checked: splitLayout === null,
          onSelect: () => {
            if (path) useSplitViewStore.getState().close(path);
          },
        },
        splitItem("split-columns", "columns", t("viewer.split.columns"), SquareSplitHorizontal),
        splitItem("split-rows", "rows", t("viewer.split.rows"), SquareSplitVertical),
      ],
    },
    {
      type: "submenu",
      id: "page-colors",
      icon: Palette,
      label: t("viewer.pageDisplay.pageColors"),
      items: PAGE_COLOR_SCHEMES.map((scheme) => ({
        type: "item",
        id: `page-colors-${scheme}`,
        label: t(`viewer.pageDisplay.colors.${scheme}`),
        checked: pageColors === scheme,
        onSelect: () => choosePageColors(scheme),
      })),
    },
  ];

  return (
    <>
      <IconButton
        icon={SPREAD_ICONS[spreadMode] ?? File}
        label={t("viewer.pageDisplay.title")}
        active={anchor !== null}
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
      />
      {anchor ? <ContextMenu anchor={anchor} items={items} label={t("viewer.pageDisplay.title")} onClose={() => setAnchor(null)} /> : null}
    </>
  );
}
