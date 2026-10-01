import type { RpcError } from "@/types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function describeError(t: Translate, error: RpcError): string {
  const reason = typeof error.data?.reason === "string" ? error.data.reason : null;
  const specific = reason ? t(`errors.reasons.${reason}`, { ...error.data, defaultValue: "" }) : "";
  if (specific) return specific;
  return t(`errors.${error.code}`, { defaultValue: error.message });
}
