import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { useViewerPanelsStore, type ViewerPanels } from "@/shared/store/viewerPanelsStore";

export const LAUNCH_PANELS = ["attachments", "comments", "inspector", "readAloud", "translate"] as const satisfies readonly (keyof ViewerPanels)[];

export type LaunchPanel = (typeof LAUNCH_PANELS)[number];

export type LaunchRequest = { panel: LaunchPanel | null; print: boolean };

export function launchRequest(params: URLSearchParams): LaunchRequest {
  const panel = params.get("panel");
  return { panel: LAUNCH_PANELS.find((item) => item === panel) ?? null, print: params.get("action") === "print" };
}

export function withoutLaunchRequest(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("panel");
  next.delete("action");
  return next;
}

export function leavesForDocument(pathname: string, documentRoute: string): boolean {
  return pathname !== "/pages" && pathname !== documentRoute;
}

export function useLaunchRequest(documentId: string | null): void {
  const [params, setParams] = useSearchParams();
  const setPanels = useViewerPanelsStore((state) => state.setPanels);

  useEffect(() => {
    if (!documentId || (!params.has("panel") && !params.has("action"))) return;
    const { panel, print } = launchRequest(params);
    if (panel) setPanels((panels) => ({ ...panels, [panel]: true }));
    if (print) usePrintDialogStore.getState().setOpen(true);
    setParams(withoutLaunchRequest(params), { replace: true });
  }, [documentId, params, setParams, setPanels]);
}
