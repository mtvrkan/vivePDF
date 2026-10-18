import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SANITIZE, type SecurityTab } from "@/features/tools/security/securityForm";
import { toRpcError } from "@/shared/rpc/client";
import { inspectPrivacy } from "@/shared/rpc/operations";
import type { DocumentInfo, PrivacyReport, RpcError, SanitizeOption } from "@/types";

type PrivacyScanInput = {
  tab: SecurityTab;
  sourcePath: string | null;
  sourcePassword: string | undefined;
  info: DocumentInfo | null | undefined;
};

export function usePrivacyScan({ tab, sourcePath, sourcePassword, info }: PrivacyScanInput) {
  const [report, setReport] = useState<PrivacyReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<RpcError | null>(null);
  const [sanitizeOptions, setSanitizeOptions] = useState<Record<SanitizeOption, boolean>>(DEFAULT_SANITIZE);

  const scanRequest = useRef(0);

  const scan = useCallback(async () => {
    if (!sourcePath) return;
    const request = ++scanRequest.current;
    setScanning(true);
    setScanError(null);
    try {
      const found = await inspectPrivacy({ path: sourcePath, password: sourcePassword });
      if (request === scanRequest.current) setReport(found);
    } catch (error) {
      if (request !== scanRequest.current) return;
      setReport(null);
      setScanError(toRpcError(error));
    } finally {
      if (request === scanRequest.current) setScanning(false);
    }
  }, [sourcePath, sourcePassword]);

  useEffect(() => {
    scanRequest.current += 1;
    setScanning(false);
    setReport(null);
    setScanError(null);
    if (tab === "privacy" && sourcePath && info) void scan();
  }, [tab, sourcePath, info, scan]);

  return { report, scanning, scanError, scan, sanitizeOptions, setSanitizeOptions };
}
