import { useTranslation } from "react-i18next";
import { useUiStore } from "@/shared/store/uiStore";
import type { ThesisCheckItem } from "@/types";
import { localNumber } from "./thesisCheckRules";

export function useThesisDetail() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (item: ThesisCheckItem) => {
    const place = item.expected && item.id === "pageNumberPlace" ? t(`tools.thesisCheck.places.${item.expected}`) : "";
    return t(`tools.thesisCheck.checks.${item.id}.${item.status}`, {
      count: item.pageTotal,
      expected: localNumber(item.expected, locale),
      found: localNumber(item.found, locale),
      place,
      defaultValue: t("tools.thesisCheck.skipped"),
    });
  };
}
