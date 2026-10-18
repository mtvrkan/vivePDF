import type { BlackoutMode, PresentationTool } from "@/shared/store/presentationStore";

export type EscapeStep = "closeCodeBlock" | "closeOverview" | "pointer" | "leaveBoard" | "exit";

export type EscapeContext = { codeBlockOpen: unknown; overviewOpen: boolean; tool: PresentationTool; blackout: BlackoutMode };

export function escapeStep({ codeBlockOpen, overviewOpen, tool, blackout }: EscapeContext): EscapeStep {
  if (codeBlockOpen) return "closeCodeBlock";
  if (overviewOpen) return "closeOverview";
  if (tool !== "pointer") return "pointer";
  if (blackout !== "none") return "leaveBoard";
  return "exit";
}
