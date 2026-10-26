import type { CvStep } from "./CvForm";
import type { CvSectionKey } from "./cvModel";

export type CvStepId = CvStep | "design";

export function cvSteps(order: CvSectionKey[]): CvStepId[] {
  return ["personal", ...order, "design"];
}
