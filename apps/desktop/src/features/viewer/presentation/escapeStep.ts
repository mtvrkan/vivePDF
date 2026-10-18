import type { BlackoutMode, PresentationTool } from "@/shared/store/presentationStore";

export type EscapeStep = "dialog" | "closeCodeBlock" | "closeOverview" | "pointer" | "leaveBoard" | "exit";

export type EscapeContext = { codeBlockOpen: unknown; overviewOpen: boolean; tool: PresentationTool; blackout: BlackoutMode; openDialogs?: number };

export function escapeStep({ codeBlockOpen, overviewOpen, tool, blackout, openDialogs = 0 }: EscapeContext): EscapeStep {
  if (openDialogs > (codeBlockOpen ? 1 : 0)) return "dialog";
  if (codeBlockOpen) return "closeCodeBlock";
  if (overviewOpen) return "closeOverview";
  if (tool !== "pointer") return "pointer";
  if (blackout !== "none") return "leaveBoard";
  return "exit";
}
