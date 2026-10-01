function trLower(value: string): string {
  return value.toLocaleLowerCase("tr");
}

export function rowMatches(query: string, label: string, hint?: string): boolean {
  const needle = trLower(query.trim());
  if (!needle) return true;
  if (trLower(label).includes(needle)) return true;
  if (hint && trLower(hint).includes(needle)) return true;
  return false;
}
