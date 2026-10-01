import { useCallback, useEffect, useState } from "react";
import { pdfaValidator } from "@/shared/rpc/operations";
import type { PdfaValidatorResult } from "@/types";

let probe: Promise<PdfaValidatorResult> | null = null;

function probeOnce(): Promise<PdfaValidatorResult> {
  probe ??= pdfaValidator().catch(() => ({ available: false }));
  return probe;
}

export function useVeraPdfValidator() {
  const [info, setInfo] = useState<PdfaValidatorResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void probeOnce().then((value) => {
      if (active) setInfo(value);
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    probe = null;
    setInfo(null);
    setAttempt((value) => value + 1);
  }, []);

  return { info, refresh };
}
