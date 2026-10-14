export type BoxSize = { width: number; height: number };

export function fitBox(available: BoxSize, aspect: number): BoxSize {
  if (available.width <= 0 || available.height <= 0 || !(aspect > 0)) return { width: 0, height: 0 };
  if (available.width / available.height > aspect) return { width: Math.floor(available.height * aspect), height: Math.floor(available.height) };
  return { width: Math.floor(available.width), height: Math.floor(available.width / aspect) };
}
