import type { CompressProfile } from "@/types";

export const PROFILES: CompressProfile[] = ["light", "balanced", "strong", "extreme", "custom"];
const LADDER_ONLY = ["minimal", "minimalGray"];

export function profileLabelKey(profileUsed: string): string | null {
  if ((PROFILES as string[]).includes(profileUsed)) return `tools.compress.profiles.${profileUsed}.title`;
  if (LADDER_ONLY.includes(profileUsed)) return `tools.compress.ladder.${profileUsed}`;
  return null;
}
