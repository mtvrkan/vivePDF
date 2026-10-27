import { useTranslation } from "react-i18next";
import { useUiStore } from "@/shared/store/uiStore";
import type { ThesisCheckItem, ThesisPageDetail } from "@/types";
import { localNumber } from "./thesisCheckRules";

const MM_CHECKS = new Set(["paper", "marginTop", "marginBottom", "marginLeft", "marginRight"]);

export type ThesisPageLine = { page: number; expected: string | null; found: string | null; note: string | null; text: string | null };

export function useThesisDetail() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (item: ThesisCheckItem) => {
    const place = item.expected && item.id === "pageNumberPlace" ? t(`tools.thesisCheck.places.${item.expected}`) : "";
    const key = item.reason ? `tools.thesisCheck.checks.${item.id}.${item.reason}` : `tools.thesisCheck.checks.${item.id}.${item.status}`;
    return t(key, {
      count: item.pageTotal,
      expected: localNumber(item.expected, locale),
      found: localNumber(item.found, locale),
      place,
      defaultValue: t("tools.thesisCheck.skipped"),
    });
  };
}

export function useThesisPageLine() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  const style = (value: string) => {
    const [family, size, weight] = value.split("|");
    if (!size) return value;
    return [family || t("tools.thesisCheck.detail.unnamedFont"), t("tools.thesisCheck.detail.units.pt", { value: localNumber(size, locale) }), t(`tools.thesisCheck.detail.${weight === "bold" ? "bold" : "regular"}`)].join(", ");
  };

  const value = (id: string, raw: string | null, side: "expected" | "found"): string | null => {
    if (raw === null) return null;
    if (MM_CHECKS.has(id)) return t("tools.thesisCheck.detail.units.mm", { value: localNumber(raw, locale) });
    if (id === "bodySize") return t("tools.thesisCheck.detail.units.pt", { value: localNumber(raw, locale) });
    if (id === "lineSpacing") return t(side === "expected" ? "tools.thesisCheck.detail.units.lines" : "tools.thesisCheck.detail.units.pt", { value: localNumber(raw, locale) });
    if (id === "pageNumberPlace") return t(`tools.thesisCheck.places.${raw}`, { defaultValue: raw });
    if (id === "frontRoman" && raw === "roman") return t("tools.thesisCheck.detail.roman");
    if (id === "headings") return style(raw);
    return raw;
  };

  const note = (raw: string | null): string | null => {
    if (!raw) return null;
    const level = /^level(\d+)$/.exec(raw);
    if (level) return t("tools.thesisCheck.detail.level", { level: level[1] });
    return t(`tools.thesisCheck.detail.notes.${raw}`, { defaultValue: "" }) || null;
  };

  return (id: string, detail: ThesisPageDetail): ThesisPageLine => {
    const expected = value(id, detail.expected, "expected");
    const found = value(id, detail.found, "found");
    return {
      page: detail.page,
      expected,
      found: found ?? (expected ? t("tools.thesisCheck.detail.none") : null),
      note: note(detail.note),
      text: detail.text,
    };
  };
}
