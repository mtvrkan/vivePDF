export function toggleOption(options: string[], current: unknown, option: string, checked: boolean): string[] {
  const picked = new Set(Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : []);
  if (checked) picked.add(option);
  else picked.delete(option);
  return options.filter((item) => picked.has(item));
}
