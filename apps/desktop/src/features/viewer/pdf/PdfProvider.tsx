import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { PrintFrame } from "@embedpdf/plugin-print/react";
import { ErrorState } from "@/components/shared/ErrorState";
import { AnnotationAuthorSync } from "../AnnotationAuthorSync";
import { viewerPlugins } from "./plugins";
import { FALLBACK_FONT_SCHEME, buildFontFallbackConfig, fallbackFontBaseUrl } from "./fontFallback";

const PDFIUM_WASM_URL = new URL("/pdfium.wasm", window.location.origin).href;
const FONT_FALLBACK = buildFontFallbackConfig(fallbackFontBaseUrl(convertFileSrc("", FALLBACK_FONT_SCHEME)));

export const READY_MARK = "vivepdf:ready";

function ReadyMark() {
  useEffect(() => {
    if (performance.getEntriesByName(READY_MARK).length === 0) performance.mark(READY_MARK);
  }, []);
  return null;
}

export function PdfProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl: PDFIUM_WASM_URL, fontFallback: FONT_FALLBACK });

  if (error) {
    return (
      <div className="h-full bg-background">
        <ErrorState title={t("viewer.engineError")} message={t("viewer.engineErrorHint")} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const loading = (
    <div className="flex h-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
      {t("viewer.engineLoading")}
    </div>
  );

  if (isLoading || !engine) return loading;

  return (
    <EmbedPDF
      engine={engine}
      plugins={viewerPlugins}
      onInitialized={async (registry) => {
        if (import.meta.env.DEV) (window as unknown as { __vivepdfRegistry?: unknown }).__vivepdfRegistry = registry;
      }}
    >
      {({ pluginsReady }) =>
        pluginsReady ? (
          <>
            <ReadyMark />
            {children}
            <AnnotationAuthorSync />
            <PrintFrame />
          </>
        ) : (
          loading
        )
      }
    </EmbedPDF>
  );
}
