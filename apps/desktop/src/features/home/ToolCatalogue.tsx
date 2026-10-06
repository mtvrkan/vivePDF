import { useTranslation } from "react-i18next";
import { bySize, sectionPadding, type HomeSize } from "./homeLayout";
import { ToolBrowser } from "./ToolBrowser";

export function ToolCatalogue({ size = "medium" }: { size?: HomeSize }) {
  const { t } = useTranslation();

  return (
    <section className={`glass rounded-2xl ${sectionPadding(size)}`}>
      <ToolBrowser title={t("home.catalog.title")} collapsible limit={bySize(size, 6, 12, 24)} />
    </section>
  );
}
