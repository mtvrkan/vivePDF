import { AlignCenter, AlignLeft, AlignRight, Hash, PanelBottom, PanelTop, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import type { DocumentAlign, DocumentSettings } from "@/types/studio";
import { NumberInput } from "../design/controls";
import { RibbonButton, RibbonGroup, RibbonRow, RibbonRows, RibbonSmallButton } from "../ribbon/Ribbon";
import { useDocumentStore } from "./documentStore";
import { useFurnitureEditing, type FurniturePart } from "./furnitureEditing";
import { DOCUMENT_ALIGNS, PAGE_NUMBER_START } from "./model";

const ALIGN_ICONS: Record<DocumentAlign, LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const PART_ICONS: Record<FurniturePart, LucideIcon> = { header: PanelTop, footer: PanelBottom };

export function FurnitureGroups({ settings, numberItems, onClose }: { settings: DocumentSettings; numberItems: ContextMenuItem[]; onClose: () => void }) {
  const { t } = useTranslation();
  const editing = useFurnitureEditing((state) => state.editing) ?? "header";
  const open = useFurnitureEditing((state) => state.open);
  const update = (patch: Partial<DocumentSettings>) => useDocumentStore.getState().setSettings(patch);
  const alignKey = editing === "header" ? "headerAlign" : "footerAlign";

  return (
    <>
      <RibbonGroup label={t("studio.doc.ribbon.groups.furniture")}>
        {(["header", "footer"] as const).map((part) => (
          <RibbonButton key={part} icon={PART_ICONS[part]} label={t(`studio.doc.ribbon.${part}`)} active={editing === part} onClick={() => open(part)} testId={`doc-furniture-${part}`} />
        ))}
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.position")}>
        <RibbonRow>
          {DOCUMENT_ALIGNS.map((align) => (
            <IconButton key={align} icon={ALIGN_ICONS[align]} label={t(`studio.textAlign.${align}`)} active={settings[alignKey] === align} onClick={() => update({ [alignKey]: align })} />
          ))}
        </RibbonRow>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.pageNumbers")}>
        <RibbonButton icon={Hash} label={t("studio.doc.ribbon.pageNumbers")} menu={numberItems} testId="doc-furniture-numbers" />
        {settings.pageNumbers !== "none" ? (
          <RibbonRows>
            <RibbonRow>
              <span className="w-20 truncate text-xs text-muted-foreground">{t("studio.doc.settings.numberFormat")}</span>
              <TextInput
                value={settings.pageNumberFormat}
                maxLength={40}
                title={t("studio.doc.settings.numberFormatHint")}
                aria-label={t("studio.doc.settings.numberFormat")}
                onChange={(event) => update({ pageNumberFormat: event.target.value })}
                className="h-8 w-36 font-mono text-sm"
                data-testid="doc-number-format"
              />
            </RibbonRow>
            <RibbonRow>
              <span className="w-20 truncate text-xs text-muted-foreground">{t("studio.doc.mainMatter.startAt")}</span>
              <NumberInput
                value={settings.pageNumberStart}
                min={PAGE_NUMBER_START[0]}
                max={PAGE_NUMBER_START[1]}
                step={1}
                ariaLabel={t("studio.doc.mainMatter.startAt")}
                onChange={(value) => update({ pageNumberStart: Math.round(value) })}
                className="w-36"
              />
            </RibbonRow>
          </RibbonRows>
        ) : null}
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.options")}>
        <RibbonRows>
          <RibbonSmallButton icon={PanelTop} label={t("studio.doc.settings.furnitureOnFirst")} active={settings.furnitureOnFirst} onClick={() => update({ furnitureOnFirst: !settings.furnitureOnFirst })} testId="doc-furniture-first" />
        </RibbonRows>
      </RibbonGroup>
      <RibbonGroup label={t("studio.doc.ribbon.groups.close")}>
        <RibbonButton icon={X} label={t("studio.doc.ribbon.closeFurniture")} onClick={onClose} testId="doc-furniture-close" />
      </RibbonGroup>
    </>
  );
}
