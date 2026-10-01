import type { PreflightCheck } from "@/types";

export function preflightDetailKey(item: PreflightCheck): string {
  if (item.variant) return `tools.preflight.checks.${item.id}.${item.variant}`;
  if ((item.id === "colorSpaces" || item.id === "vectorColors") && item.status === "pass" && !item.value) return `tools.preflight.checks.${item.id}.none`;
  return `tools.preflight.checks.${item.id}.${item.status}`;
}
