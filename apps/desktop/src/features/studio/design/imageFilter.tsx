import { useId, useMemo, type ReactNode } from "react";
import type { StudioImageFilters } from "@/types/studio";
import { filterMatrix, svgColorMatrix } from "../model/imageFilters";

export function useImageFilter(filters: StudioImageFilters | undefined): { css: string | undefined; defs: ReactNode } {
  const id = `imagefilter${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const values = useMemo(() => {
    const matrix = filterMatrix(filters);
    return matrix ? svgColorMatrix(matrix) : null;
  }, [filters]);
  if (!values) return { css: undefined, defs: null };
  return {
    css: `url(#${id})`,
    defs: (
      <svg width="0" height="0" aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
          <feColorMatrix type="matrix" values={values} />
        </filter>
      </svg>
    ),
  };
}
