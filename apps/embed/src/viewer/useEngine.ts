import { useEffect, useState } from "preact/hooks";
import type { PdfEngine } from "@embedpdf/models";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import { cachedEngineUrl, type CachedEngine } from "../engine/engineCache";
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
    let cached: CachedEngine | null = null;
    let stopWatching = () => {};
    setState({ engine: null, failure: null });
    const fail = (failure: EngineFailure) => {
      if (!cancelled) setState({ engine: null, failure });
    };
    cachedEngineUrl(wasmUrl, __ENGINE_BUILD__)
      .then((entry) => {
        if (cancelled) {
          entry.release();
          return null;
        }
        cached = entry;
        const { result, workers } = captureWorkers(() => createPdfiumEngine(entry.url, { fontFallback: fontBase ? fallbackFonts(fontBase) : null }));
        stopWatching = watchEngineWorkers(workers, fail);
        return result;
      })
      .then(
        (engine) => {
          if (!engine) return;
          created = engine;
          if (cancelled) release(engine);
          else setState((current) => (current.failure ? current : { engine, failure: null }));
        },
        () => fail("start"),
      );
    return () => {
      cancelled = true;
      stopWatching();
      if (created) release(created);
      cached?.release();
    };
  }, [wasmUrl, fontBase, attempt]);
  return state;
}
