import { Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { RibbonButton } from "../ribbon/Ribbon";
import { SECTION_COLUMNS } from "./sections";

export function SectionBreakMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
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

  return <RibbonButton icon={Columns2} label={t("studio.doc.section.button")} menu={items} testId="doc-section-break" />;
}
