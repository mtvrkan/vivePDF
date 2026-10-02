import type { ReactNode } from "react";

export function MessageRow({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <div role="status" data-message-tone={tone} className="glass-flat flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
      {children}
    </div>
  );
}
