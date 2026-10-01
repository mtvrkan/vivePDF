import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import { extensionOf } from "@/shared/lib/paths";
import type { AccessStatus } from "@/types";

export type CheckReportFormat = "md" | "csv" | "json";

export type CheckReportRow = { id: string; status: AccessStatus; title: string; detail: string };

export type CheckReportDocument = {
  heading: string;
  source: string;
  generatedAt: string;
  summary: string[];
  columns: { check: string; status: string; detail: string };
  statusLabels: Record<AccessStatus, string>;
  rows: CheckReportRow[];
  extra?: { title: string; lines: string[] };
};

const FORMULA_START = /^[=+\-@\t\r]/;

export function detailWithPages(detail: string, pages: number[] | undefined, line: (list: string) => string): string {
  return pages && pages.length > 0 ? `${detail} · ${line(pages.join(", "))}` : detail;
}

export function reportFormatOf(path: string): CheckReportFormat {
  const extension = extensionOf(path).toLowerCase();
  if (extension === "csv") return "csv";
  if (extension === "json") return "json";
  return "md";
}

function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",;\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatCheckReport(report: CheckReportDocument, format: CheckReportFormat): string {
  if (format === "json") {
    return `${JSON.stringify(
      {
        heading: report.heading,
        source: report.source,
        generatedAt: report.generatedAt,
        summary: report.summary,
        checks: report.rows.map((row) => ({ id: row.id, status: row.status, title: row.title, detail: row.detail })),
        ...(report.extra ? { details: { title: report.extra.title, lines: report.extra.lines } } : {}),
      },
      null,
      2,
    )}\n`;
  }
  if (format === "csv") {
    const lines = [[report.columns.check, report.columns.status, report.columns.detail].map(csvCell).join(",")];
    for (const row of report.rows) lines.push([row.title, report.statusLabels[row.status], row.detail].map(csvCell).join(","));
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }
  const lines = [`# ${markdownCell(report.heading)}`, "", `${markdownCell(report.source)} · ${report.generatedAt}`, ""];
  for (const line of report.summary) lines.push(`- ${markdownCell(line)}`);
  lines.push("", `| ${markdownCell(report.columns.check)} | ${markdownCell(report.columns.status)} | ${markdownCell(report.columns.detail)} |`, "| --- | --- | --- |");
  for (const row of report.rows) lines.push(`| ${markdownCell(row.title)} | ${markdownCell(report.statusLabels[row.status])} | ${markdownCell(row.detail)} |`);
  if (report.extra && report.extra.lines.length > 0) {
    lines.push("", `## ${markdownCell(report.extra.title)}`, "");
    for (const line of report.extra.lines) lines.push(`- ${markdownCell(line)}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function saveCheckReport(report: CheckReportDocument, defaultPath: string, filterName: string): Promise<string | null> {
  const path = await saveDialog({
    defaultPath,
    filters: [
      { name: `${filterName} (Markdown)`, extensions: ["md"] },
      { name: `${filterName} (CSV)`, extensions: ["csv"] },
      { name: `${filterName} (JSON)`, extensions: ["json"] },
    ],
  });
  if (!path) return null;
  try {
    await invoke("write_text_file", { path, contents: formatCheckReport(report, reportFormatOf(path)) });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
  return path;
}
