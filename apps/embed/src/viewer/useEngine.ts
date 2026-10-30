import { useEffect, useState } from "preact/hooks";
import type { PdfEngine } from "@embedpdf/models";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import { fallbackFonts } from "../engine/fonts";

export type EngineState = { engine: PdfEngine | null; error: unknown };

function release(engine: PdfEngine): void {
  engine.closeAllDocuments?.().wait(
    () => engine.destroy?.(),
    () => engine.destroy?.(),
  );
}

export function useEngine(wasmUrl: string, fontBase: string | null): EngineState {
  const [state, setState] = useState<EngineState>({ engine: null, error: null });
  useEffect(() => {
    let cancelled = false;
    let created: PdfEngine | null = null;
    Promise.resolve(createPdfiumEngine(wasmUrl, { fontFallback: fontBase ? fallbackFonts(fontBase) : null })).then(
      (engine) => {
        created = engine;
        if (cancelled) release(engine);
        else setState({ engine, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setState({ engine: null, error });
      },
    );
    return () => {
      cancelled = true;
      if (created) release(created);
    };
  }, [wasmUrl, fontBase]);
  return state;
}
