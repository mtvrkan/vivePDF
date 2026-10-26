import type { DocumentHeadingNumbers } from "@/types/studio";

export const HEADING_NUMBER_STYLES: DocumentHeadingNumbers[] = ["none", "plain", "dotted"];
const NUMBERED_LEVELS = 4;

export class HeadingCounter {
  private counts = Array<number>(NUMBERED_LEVELS).fill(0);

  constructor(private readonly style: DocumentHeadingNumbers) {}

  next(level: number): string | null {
    if (this.style === "none" || level < 1 || level > NUMBERED_LEVELS) return null;
    this.counts[level - 1] += 1;
    this.counts.fill(0, level);
    const label = this.counts.slice(0, level).join(".");
    return this.style === "dotted" ? `${label}.` : label;
  }
}
