import type { RedactionItem } from "@embedpdf/plugin-redaction";
import { redactedText, scrubHidden } from "@/shared/rpc/operations";
import type { ScrubArea } from "@/types";

export type ScrubPlan = { areas: ScrubArea[]; texts: string[] };

export function redactionAreas(pending: Record<number, RedactionItem[]> | undefined): ScrubPlan {
  const areas: ScrubArea[] = [];
  const texts: string[] = [];
  for (const items of Object.values(pending ?? {})) {
    for (const item of items) {
      const rects = item.kind === "text" && item.rects.length > 0 ? item.rects : [item.rect];
      for (const rect of rects) {
        areas.push({ page: item.page + 1, x0: rect.origin.x, y0: rect.origin.y, x1: rect.origin.x + rect.size.width, y1: rect.origin.y + rect.size.height });
      }
      if (item.kind === "text" && item.text?.trim()) texts.push(item.text.trim());
    }
  }
  return { areas, texts };
}

export async function planRedactionScrub(path: string, password: string | undefined, pending: Record<number, RedactionItem[]> | undefined): Promise<ScrubPlan | null> {
  const plan = redactionAreas(pending);
  if (plan.areas.length === 0) return null;
  const found = await redactedText({ path, password, areas: plan.areas }).then(
    (result) => result.texts,
    () => [] as string[],
  );
  return { areas: plan.areas, texts: [...new Set([...plan.texts, ...found])] };
}

export async function scrubRedactedFile(path: string, password: string | undefined, plan: ScrubPlan | null): Promise<number> {
  if (!plan) return 0;
  const result = await scrubHidden({ path, password, texts: plan.texts, areas: plan.areas });
  return result.hidden;
}
