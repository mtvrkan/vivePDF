import { useId } from "react";
import { cn } from "@/shared/lib/cn";

export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `url(#${id}-${name})`;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="vivePDF" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#24497F" />
          <stop offset="0.55" stopColor="#14305A" />
          <stop offset="1" stopColor="#0A1A33" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E6EEF8" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7FD0FF" />
          <stop offset="1" stopColor="#2F8FE6" />
        </linearGradient>
        <linearGradient id={`${id}-flap`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#BFE3FF" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9FD2FF" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#9FD2FF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#9FD2FF" stopOpacity="0.06" />
        </linearGradient>
        <clipPath id={`${id}-tile`}>
          <rect x="8" y="8" width="240" height="240" rx="60" />
        </clipPath>
        <filter id={`${id}-lift`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#000814" floodOpacity="0.35" />
        </filter>
        <filter id={`${id}-cast`} x="-30%" y="-20%" width="160%" height="150%">
          <feDropShadow dx="-5" dy="3" stdDeviation="4.5" floodColor="#04122A" floodOpacity="0.45" />
        </filter>
        <filter id={`${id}-fold`} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="-2" dy="2.5" stdDeviation="2" floodColor="#04122A" floodOpacity="0.4" />
        </filter>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="60" fill={ref("bg")} />
      <rect x="8" y="8" width="240" height="132" fill={ref("sheen")} clipPath={ref("tile")} />
      <rect x="9.5" y="9.5" width="237" height="237" rx="58.5" fill="none" stroke={ref("edge")} strokeWidth="3" />
      <g filter={ref("lift")}>
        <path d="M60 60H104L148 196H104Z" fill={ref("left")} />
        <path d="M152 60H176L189.6 80L152 196H108Z" fill={ref("right")} filter={ref("cast")} />
        <path d="M176 60V80H189.6Z" fill={ref("flap")} filter={ref("fold")} />
      </g>
    </svg>
  );
}
