import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import i18n from "@/app/i18n";
import { diagnosticsBlock, environmentLines } from "@/shared/lib/diagnosticsText";
import { describeError } from "@/shared/lib/errorMessage";
import * as logger from "@/shared/lib/logger";
import { RevealError, revealPath } from "@/shared/lib/reveal";
import { toRpcError } from "@/shared/rpc/client";
import { supportBundle } from "@/shared/rpc/operations";
import { useEngineStore } from "@/shared/store/engineStore";
import type { DiagnosticsInfo } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";
import type { SupportBundleParams, SupportImage, SupportText } from "@/types";

export type SupportLogs = { current: string; previous: string };

export type SupportContent = { report?: string; attachments?: string[]; images?: SupportImage[] };

export type SupportSources = { diagnostics: DiagnosticsInfo | null; logs: SupportLogs | null; environment: string[]; locale: string };

export function supportFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `vivepdf-support-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

export function supportBundleParams(output: string, content: SupportContent, sources: SupportSources): SupportBundleParams {
  const texts: SupportText[] = [];
  if (content.report?.trim()) texts.push({ name: "report.txt", text: content.report });
  const diagnostics = sources.diagnostics
    ? diagnosticsBlock(sources.diagnostics, sources.environment, 0, sources.locale)
    : [...sources.environment, `Locale: ${sources.locale}`].join("\n");
  texts.push({ name: "diagnostics.txt", text: diagnostics });
  if (sources.logs?.current) texts.push({ name: "vivepdf.log", text: sources.logs.current, folder: "logs" });
  if (sources.logs?.previous) texts.push({ name: "vivepdf.log.1", text: sources.logs.previous, folder: "logs" });
  return { output, texts, attachments: content.attachments ?? [], images: content.images ?? [], overwrite: true };
}

async function quietly<T>(command: string): Promise<T | null> {
  try {
    return await invoke<T>(command);
  } catch (error) {
    logger.warn("support", `${command} unavailable: ${String(error)}`);
    return null;
  }
}

async function readSources(): Promise<SupportSources> {
  const [diagnostics, logs] = await Promise.all([quietly<DiagnosticsInfo>("diagnostics_info"), quietly<SupportLogs>("support_logs")]);
  return {
    diagnostics,
    logs,
    environment: environmentLines(useEngineStore.getState().info, useToolsStatusStore.getState().tools),
    locale: `${i18n.language} (system ${navigator.language})`,
  };
}

export function supportErrorMessage(error: unknown): string {
  const rpcError = toRpcError(error);
  const reason = rpcError.data?.reason;
  if (reason === "tooLarge") return i18n.t("support.tooLarge", { limit: Number(rpcError.data?.limitMb ?? 0) });
  if (reason === "badImage") return i18n.t("support.badImage");
  return describeError(i18n.t, rpcError);
}

async function reveal(path: string): Promise<void> {
  try {
    await revealPath(path);
  } catch (caught) {
    useToastStore.getState().push("error", i18n.t(caught instanceof RevealError ? caught.reasonKey : "errors.revealFailed"));
  }
}

export async function saveSupportBundle(content: SupportContent = {}): Promise<string | null> {
  const toast = useToastStore.getState().push;
  try {
    const output = await save({ defaultPath: supportFileName(), filters: [{ name: "ZIP", extensions: ["zip"] }] });
    if (!output) return null;
    const result = await supportBundle(supportBundleParams(output, content, await readSources()));
    logger.info("support", `bundle saved with ${result.files} files`);
    toast("success", i18n.t("support.saved"), { label: i18n.t("tools.reveal"), onClick: () => void reveal(result.output) });
    return result.output;
  } catch (error) {
    logger.error("support", `bundle failed: ${String(error)}`);
    toast("error", supportErrorMessage(error));
    return null;
  }
}
