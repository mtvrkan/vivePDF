import { useEffect, useState } from "react";
import { fontCatalogue } from "@/shared/rpc/operations";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import type { FontChoice } from "@/types";
import { BOLD_WEIGHT, REGULAR_WEIGHT } from "../model/typography";

let cached: { revision: number; fonts: Promise<FontChoice[]> } | null = null;
const refreshed = new Set<string>();

function catalogue(revision: number, refresh = false): Promise<FontChoice[]> {
  if (!cached || cached.revision !== revision || refresh) {
    cached = {
      revision,
      fonts: fontCatalogue()
        .then((result) => result.fonts)
        .catch(() => []),
    };
  }
  return cached.fonts;
}

export function hasExtraWeights(weights: number[]): boolean {
  return weights.some((weight) => weight !== REGULAR_WEIGHT && weight !== BOLD_WEIGHT);
}

export function nearestWeight(weights: number[], wanted: number): number {
  if (!weights.length) return wanted;
  return weights.reduce((best, weight) => {
    const distance = Math.abs(weight - wanted) - Math.abs(best - wanted);
    if (distance !== 0) return distance < 0 ? weight : best;
    return wanted >= REGULAR_WEIGHT ? Math.max(best, weight) : Math.min(best, weight);
  });
}

export function useFontWeights(fontId: string): number[] {
  const revision = useFontLibraryStore((state) => state.revision);
  const [weights, setWeights] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    const pick = (fonts: FontChoice[]) => fonts.find((font) => font.id === fontId);
    void catalogue(revision).then(async (fonts) => {
      let found = pick(fonts);
      if (!found && !refreshed.has(fontId)) {
        refreshed.add(fontId);
        found = pick(await catalogue(revision, true));
      }
      if (live) setWeights(found?.weights ?? []);
    });
    return () => {
      live = false;
    };
  }, [fontId, revision]);
  return weights;
}
