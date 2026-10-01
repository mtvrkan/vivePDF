import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/tool/form";

export type CompareView = "sideBySide" | "overlay";

const VIEWS: CompareView[] = ["sideBySide", "overlay"];

export function CompareViewSwitch({ value, onChange }: { value: CompareView; onChange: (view: CompareView) => void }) {
  const { t } = useTranslation();
  return <Segmented size="sm" value={value} options={VIEWS} labelOf={(view) => t(`tools.compare.sideBySide.views.${view}`)} onChange={onChange} ariaLabel={t("tools.compare.sideBySide.viewLabel")} />;
}
