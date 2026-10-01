import type { TranslateModel } from "@/types";

export const PIVOT_LANGUAGE = "en";

const LOCALE_BY_CODE: Record<string, string> = { pb: "pt-BR", zh: "zh-CN", zt: "zh-Hant" };

export type LanguagePackState = "full" | "partial" | "none";

export type LanguagePack = {
  code: string;
  pairs: TranslateModel[];
  missing: string[];
  state: LanguagePackState;
  version: string;
  sizeMb: number;
  missingSizeMb: number;
};

export function localeOfLanguage(code: string): string {
  return LOCALE_BY_CODE[code] ?? code;
}

export function languageCodeFor(locale: string): string {
  const base = locale.split("-")[0]?.toLowerCase() ?? "en";
  return base === "pt" ? "pb" : base;
}

export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(localeOfLanguage(code)) ?? code;
  } catch {
    return code;
  }
}

export function pairLanguages(modelId: string): [string, string] {
  const [source = "", target = ""] = modelId.split("_");
  return [source, target];
}

export function partnerLanguage(modelId: string): string {
  const [source, target] = pairLanguages(modelId);
  return source === PIVOT_LANGUAGE ? target : source;
}

function packState(installed: number, total: number): LanguagePackState {
  if (installed === 0) return "none";
  return installed === total ? "full" : "partial";
}

export function languagePacks(models: TranslateModel[]): LanguagePack[] {
  const byCode = new Map<string, TranslateModel[]>();
  for (const model of models) {
    if (model.origin !== "catalog" || !pairLanguages(model.id).includes(PIVOT_LANGUAGE)) continue;
    const code = partnerLanguage(model.id);
    byCode.set(code, [...(byCode.get(code) ?? []), model]);
  }
  return Array.from(byCode, ([code, pairs]) => {
    const ordered = [...pairs].sort((a, b) => Number(a.source === PIVOT_LANGUAGE) - Number(b.source === PIVOT_LANGUAGE));
    const missing = ordered.filter((model) => !model.installed);
    return {
      code,
      pairs: ordered,
      missing: missing.map((model) => model.id),
      state: packState(ordered.length - missing.length, ordered.length),
      version: ordered[0]?.version ?? "",
      sizeMb: ordered.reduce((total, model) => total + model.sizeMb, 0),
      missingSizeMb: missing.reduce((total, model) => total + model.sizeMb, 0),
    };
  });
}

export function packsForMissing(ids: string[]): string[] {
  const codes = ids.flatMap((id) => pairLanguages(id)).filter((code) => code && code !== PIVOT_LANGUAGE);
  return Array.from(new Set(codes));
}
