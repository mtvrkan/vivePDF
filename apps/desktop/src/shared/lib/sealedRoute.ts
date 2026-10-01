import type { RpcError } from "@/types";

export function sealedFileRoute(error: RpcError | null, fallbackPath?: string): string | null {
  if (!error || error.code !== "CERTIFICATE_SEALED") return null;
  const reported = typeof error.data?.path === "string" && error.data.path ? error.data.path : undefined;
  const path = reported ?? fallbackPath;
  const params = new URLSearchParams({ tab: "decryptCertificate" });
  if (path) params.set("sealed", path);
  return `/tools/security?${params.toString()}`;
}

export async function sealedOpenRoute(path: string, probe: (path: string) => Promise<unknown>): Promise<string | null> {
  try {
    await probe(path);
    return null;
  } catch (caught) {
    if (typeof caught !== "object" || caught === null) return null;
    const { code, message, data } = caught as Partial<RpcError>;
    if (code !== "CERTIFICATE_SEALED") return null;
    return sealedFileRoute({ code, message: String(message ?? ""), data }, path);
  }
}
