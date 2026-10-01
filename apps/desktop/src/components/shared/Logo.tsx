import { cn } from "@/shared/lib/cn";

export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="vivePDF" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="vive-bg" gradientUnits="userSpaceOnUse" x1="32" y1="2" x2="32" y2="62">
          <stop offset="0" stopColor="#1B86C9" />
          <stop offset="1" stopColor="#0C5187" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#vive-bg)" />
      <path d="M15 15h11l11 34H26z" fill="#FFFFFF" />
      <path d="M38 15h6l3.4 5L38 49H27z" fill="#BFE0F7" />
      <path d="M44 15v5h3.4z" fill="#FFFFFF" />
    </svg>
  );
}
