import type { AccessStatus, PreflightCheck } from "@/types";

export type PageFinding = { page: number; status: Exclude<AccessStatus, "pass">; checks: string[] };

export function findingsByPage(checks: PreflightCheck[]): PageFinding[] {
  const byPage = new Map<number, PageFinding>();
  for (const check of checks) {
    if (check.status === "pass" || !check.pages) continue;
    for (const page of check.pages) {
      const finding = byPage.get(page) ?? { page, status: check.status, checks: [] };
      if (check.status === "fail") finding.status = "fail";
      finding.checks.push(check.id);
      byPage.set(page, finding);
    }
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}
