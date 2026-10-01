import { cn } from "@/shared/lib/cn";

export type LaserPoint = { x: number; y: number };

function toPath(points: LaserPoint[]): string {
  if (points.length === 0) return "";
  const first = points[0];
  if (points.length === 1) return `M ${first.x} ${first.y} L ${first.x + 0.01} ${first.y}`;
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function LaserTrail({ points, color, size, fading }: { points: LaserPoint[]; color: string; size: number; fading?: boolean }) {
  const path = toPath(points);
  if (!path) return null;
  return (
    <svg className={cn("pointer-events-none fixed inset-0 z-40 h-full w-full", fading && "laser-fade")} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={size * 1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.4} style={{ filter: `blur(${Math.max(3, size * 0.7)}px)` }} />
      <path d={path} fill="none" stroke={color} strokeWidth={size * 0.55} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
      <path d={path} fill="none" stroke="white" strokeWidth={Math.max(1.2, size * 0.2)} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  );
}
