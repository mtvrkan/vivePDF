import type { DiagnosticsInfo } from "@/shared/store/reportStore";
import type { SystemPingResult, ToolsStatus } from "@/types";

export function environmentLines(engine: SystemPingResult | null, tools: ToolsStatus | null): string[] {
  return [`Engine: ${engine?.version ?? "-"} (PyMuPDF ${engine?.pymupdf ?? "-"}, Python ${engine?.python ?? "-"})`, `LibreOffice: ${tools ? (tools.libreoffice ?? "not installed") : "-"}`, `OCR languages: ${tools?.ocrLanguages.join(", ") || "-"}`];
}

export function diagnosticsBlock(diagnostics: DiagnosticsInfo, environment: string[], maxLogLines: number, locale: string): string {
  const lines = [`OS: ${diagnostics.osVersion}`, `Arch: ${diagnostics.arch}`, `App version: ${diagnostics.appVersion}`, ...environment, `Locale: ${locale}`];
  if (maxLogLines === 0) return lines.join("\n");
  const tail = diagnostics.logTail.split("\n").slice(-maxLogLines).join("\n");
  return [...lines, "Log tail:", tail].join("\n");
}
