export function parseGeometryValue(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export function formatGeometryValue(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export type GeometryRect = { x: number; y: number; width: number; height: number };

export function applyGeometryPatch(rect: GeometryRect, field: "x" | "y" | "width" | "height", value: number, aspectLocked: boolean, aspect: number): Partial<GeometryRect> {
  const clamped = field === "width" || field === "height" ? Math.max(1, value) : value;
  if (!aspectLocked || (field !== "width" && field !== "height")) return { [field]: clamped };
  if (field === "width") return { width: clamped, height: aspect > 0 ? clamped / aspect : rect.height };
  return { height: clamped, width: aspect > 0 ? clamped * aspect : rect.width };
}
