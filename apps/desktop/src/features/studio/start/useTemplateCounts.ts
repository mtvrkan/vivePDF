import { useEffect, useState } from "react";
import * as logger from "@/shared/lib/logger";
import type { TemplateCategory } from "../templates/kit";

export type TemplateCounts = { total: number; byCategory: Map<TemplateCategory, number> };

export function useTemplateCounts(): TemplateCounts | null {
  const [counts, setCounts] = useState<TemplateCounts | null>(null);
  useEffect(() => {
    let live = true;
    import("../templates/catalog")
      .then(({ STUDIO_TEMPLATES }) => {
        if (!live) return;
        const byCategory = new Map<TemplateCategory, number>();
        for (const template of STUDIO_TEMPLATES) byCategory.set(template.category, (byCategory.get(template.category) ?? 0) + 1);
        setCounts({ total: STUDIO_TEMPLATES.length, byCategory });
      })
      .catch((caught: unknown) => logger.warn("studio", logger.describeError(caught)));
    return () => {
      live = false;
    };
  }, []);
  return counts;
}
