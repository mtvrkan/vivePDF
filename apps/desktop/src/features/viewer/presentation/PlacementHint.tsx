import { useTranslation } from "react-i18next";

export function PlacementHint() {
  const { t } = useTranslation();
  return (
    <p role="status" className="glass pointer-events-none absolute inset-x-0 top-4 z-30 mx-auto w-fit rounded-full px-4 py-1.5 text-sm">
      {t("presentation.insert.placeHint")}
    </p>
  );
}
