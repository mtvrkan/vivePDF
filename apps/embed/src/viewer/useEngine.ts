import { useEffect, useState } from "preact/hooks";
import type { PdfEngine } from "@embedpdf/models";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import { fallbackFonts } from "../engine/fonts";
import { captureWorkers, watchEngineWorkers, type EngineFailure } from "../engine/workerWatch";

export type EngineState = { engine: PdfEngine | null; failure: EngineFailure | null };

function release(engine: PdfEngine): void {
  engine.closeAllDocuments?.().wait(
    () => engine.destroy?.(),
    () => engine.destroy?.(),
  );
}

export function useEngine(wasmUrl: string, fontBase: string | null, attempt: number): EngineState {
  const [state, setState] = useState<EngineState>({ engine: null, failure: null });
  useEffect(() => {
    let cancelled = false;
    let created: PdfEngine | null = null;
    setState({ engine: null, failure: null });
    const fail = (failure: EngineFailure) => {
      if (!cancelled) setState({ engine: null, failure });
    };
    let stopWatching = () => {};
    try {
      const { result: engine, workers } = captureWorkers(() => createPdfiumEngine(wasmUrl, { fontFallback: fontBase ? fallbackFonts(fontBase) : null }));
      stopWatching = watchEngineWorkers(workers, fail);
      created = engine;
      setState((current) => (current.failure ? current : { engine, failure: null }));
    } catch {
      fail("start");
    }
    return () => {
      cancelled = true;
      stopWatching();
      if (created) release(created);
    };
  }, [wasmUrl, fontBase, attempt]);
  return state;
}
