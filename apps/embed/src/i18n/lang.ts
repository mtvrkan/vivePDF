export type Lang = "tr" | "en";

export function resolveLang(requested: string | null, pageLang: string): Lang {
  const wanted = (requested || pageLang).toLowerCase();
  return wanted.startsWith("tr") ? "tr" : "en";
}
