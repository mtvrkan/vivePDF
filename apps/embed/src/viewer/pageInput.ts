export function parsePageInput(value: string, total: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || total < 1) return null;
  return Math.min(total, Math.max(1, Number(trimmed)));
}

export function formatZoom(level: number): string {
  return `${Math.round(level * 100)}%`;
}
