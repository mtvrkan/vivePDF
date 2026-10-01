import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-(image:--primary-gradient) text-white border-transparent shadow-[inset_0_1px_0_hsl(0_0%_100%/0.28),var(--primary-glow)] hover:brightness-110 active:translate-y-px",
  secondary: "bg-card text-foreground border-border shadow-(--shadow-card) hover:bg-secondary active:translate-y-px",
  ghost: "nav-glass bg-transparent text-foreground border-transparent",
  destructive: "bg-destructive text-destructive-foreground border-transparent shadow-[inset_0_1px_0_hsl(0_0%_100%/0.18),var(--shadow-card)] hover:bg-destructive/90 active:translate-y-px",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-row px-4 text-base gap-2 rounded-lg",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap border font-medium transition-[background-color,color,transform,box-shadow] duration-(--transition-fast) disabled:opacity-50 disabled:pointer-events-none",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
