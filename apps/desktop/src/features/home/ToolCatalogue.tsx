import { useTranslation } from "react-i18next";
import { ToolBrowser } from "./ToolBrowser";

export function ToolCatalogue() {
  const { t } = useTranslation();

  return (
    <section className="glass rounded-2xl p-5">
      <ToolBrowser title={t("home.catalog.title")} collapsible />
    </section>
  );
}
