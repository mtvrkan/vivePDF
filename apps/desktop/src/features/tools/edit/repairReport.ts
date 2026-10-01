import type { RepairIssue, RepairIssueKind, RepairResult } from "@/types";

export type RepairOutcome = {
  key: string;
  count?: number;
  blank?: number;
};

export function repairOutcome(result: RepairResult): RepairOutcome {
  const outcome = mainOutcome(result);
  const blank = result.emptyPages;
  if (blank > 0 && outcome.key !== "tools.edit.repair.allEmpty") return { ...outcome, blank };
  return outcome;
}

function mainOutcome(result: RepairResult): RepairOutcome {
  if (result.rebuilt && result.droppedPages > 0) {
    return { key: "tools.edit.repair.rebuiltPartly", count: result.droppedPages };
  }
  if (result.rebuilt) return { key: "tools.edit.repair.rebuilt" };
  if (result.pageCount > 0 && result.emptyPages >= result.pageCount) {
    return { key: "tools.edit.repair.allEmpty" };
  }
  if (result.damagedPages > 0) {
    return { key: "tools.edit.repair.damaged", count: result.damagedPages };
  }
  if (result.wasRepaired) return { key: "tools.edit.repair.repaired" };
  return { key: "tools.edit.repair.clean" };
}

export type RepairIssueGroup = { kind: RepairIssueKind; pages: number[] };

const ISSUE_ORDER: RepairIssueKind[] = ["dropped", "damaged", "empty"];

export function groupIssues(issues: RepairIssue[]): RepairIssueGroup[] {
  return ISSUE_ORDER.map((kind) => ({ kind, pages: issues.filter((issue) => issue.kind === kind).map((issue) => issue.page) })).filter((group) => group.pages.length > 0);
}

export function canOpenIssuePage(result: RepairResult, kind: RepairIssueKind): boolean {
  return result.droppedPages === 0 && kind !== "dropped";
}
