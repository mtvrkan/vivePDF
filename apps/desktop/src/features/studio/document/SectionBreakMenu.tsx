import { useState } from "react";
import { Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { SECTION_COLUMNS } from "./sections";

const MENU_GAP = 4;

export function SectionBreakMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const label = t("studio.doc.section.button");
  const items: ContextMenuItem[] = [
    ...SECTION_COLUMNS.map((columns): ContextMenuItem => ({
      type: "item",
      id: `section-${columns}`,
      label: t(`studio.doc.section.columns${columns}`),
      onSelect: () => editor.chain().focus().setSectionBreak(columns).run(),
    })),
    { type: "separator", id: "section-continuous" },
    ...SECTION_COLUMNS.map((columns): ContextMenuItem => ({
      type: "item",
      id: `section-continuous-${columns}`,
      label: t(`studio.doc.section.continuous${columns}`),
      onSelect: () => editor.chain().focus().setSectionBreak(columns, true).run(),
    })),
  ];

  return (
    <span {...{ [MENU_LAYER]: "" }} className="inline-flex">
      <IconButton
        icon={Columns2}
        label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid="doc-section-break"
        onClick={(event) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + MENU_GAP });
        }}
      />
      {anchor ? <ContextMenu anchor={anchor} items={items} label={label} onClose={() => setAnchor(null)} /> : null}
    </span>
  );
}
