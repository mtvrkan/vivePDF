const FORWARD = new Set(["ArrowRight", "ArrowDown"]);
const BACKWARD = new Set(["ArrowLeft", "ArrowUp"]);

export function rovingTarget(key: string, index: number, count: number): number | null {
  if (count === 0 || index < 0) return null;
  if (FORWARD.has(key)) return (index + 1) % count;
  if (BACKWARD.has(key)) return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
