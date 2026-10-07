import { FILLABLE_KINDS } from "@/features/tools/forms/fillValues";
import type { FormField } from "@/types";

export type PlacedWidget = { key: string; field: FormField; rect: number[]; state: string | null };

export function widgetsOnPage(fields: FormField[], page: number): PlacedWidget[] {
  const placed: PlacedWidget[] = [];
  for (const field of fields) {
    if (!FILLABLE_KINDS.includes(field.kind)) continue;
    const widgets = field.widgets ?? [{ page: field.page, visibleRect: field.visibleRect ?? field.rect, state: null }];
    widgets.forEach((widget, index) => {
      if (widget.page === page && widget.visibleRect.length === 4) placed.push({ key: `${field.name}-${index}`, field, rect: widget.visibleRect, state: widget.state });
    });
  }
  return placed.sort((left, right) => left.rect[1] - right.rect[1] || left.rect[0] - right.rect[0]);
}
