import { useLaunchStore } from "@/shared/store/launchStore";
import type { RpcError } from "@/types";

export const REPAIR_PATHNAME = "/tools/edit";
export const REPAIR_ROUTE = `${REPAIR_PATHNAME}?tab=repair`;

const REPAIRABLE_CODES = new Set(["INVALID_PDF", "INTERNAL"]);

export function canOfferRepair(error: RpcError | null, path: string | undefined, onRepairTab: boolean): path is string {
  return !!error && !!path && !onRepairTab && REPAIRABLE_CODES.has(error.code);
}

export function openInRepair(path: string, navigate: (to: string) => unknown): void {
  useLaunchStore.getState().setPending(path, REPAIR_PATHNAME);
  void navigate(REPAIR_ROUTE);
}
