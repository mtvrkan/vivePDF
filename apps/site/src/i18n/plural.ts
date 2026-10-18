export type PluralForms = { one: string; other: string };

export function plural(locale: string, forms: PluralForms, n: number): string {
  const form = new Intl.PluralRules(locale).select(n) === "one" ? forms.one : forms.other;
  return form.replace("#", new Intl.NumberFormat(locale).format(n));
}
