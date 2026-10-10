import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { isMac, shortcutLabel } from "@/shared/lib/platform";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  busy?: boolean;
  active?: boolean;
};

const ARIA_KEY_NAMES: Record<string, string> = { Ctrl: isMac ? "Meta" : "Control", Esc: "Escape", Del: "Delete" };

function ariaShortcut(shortcut: string): string {
  return shortcut
    .split(" / ")
    .map((combo) =>
      combo
        .replace(/\+\+$/, "+Plus")
        .split("+")
        .map((key) => ARIA_KEY_NAMES[key] ?? key)
        .join("+"),
    )
    .join(" ");
}

export function IconButton({ icon: Icon, label, shortcut, busy = false, active = false, className, type = "button", ...rest }: IconButtonProps) {
  const Shown = busy ? Loader2 : Icon;
  return (
    <button
      type={type}
      aria-label={label}
      title={shortcut ? `${label} (${shortcutLabel(shortcut)})` : label}
      aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
      aria-busy={busy || undefined}
      aria-pressed={active || undefined}
      className={cn(
        "nav-glass inline-flex size-8 items-center justify-center rounded-lg text-foreground/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "glass-chip text-primary",
        className,
      )}
      {...rest}
    >
      <Shown className={cn("size-4", busy && "animate-spin")} aria-hidden />
    </button>
  );
}
