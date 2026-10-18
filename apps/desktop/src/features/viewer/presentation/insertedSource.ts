import type { ChartSettings } from "@/features/viewer/overlay/chart/chartModel";
import type { DrawingSource } from "@/features/viewer/overlay/drawing/drawingSource";
import type { TableSettings } from "@/features/viewer/overlay/table/tableModel";
import type { PresentationInsertedItem, PresentationInsertedSource } from "@/types";

export const MAX_SOURCE_BYTES = 64 * 1024;
const SOURCE_VERSION = 1;

type StoredData = { settings: Record<string, unknown>; width: number; height: number };

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function insertedSourceOf(drawing: DrawingSource): PresentationInsertedSource | null {
  if (drawing.kind !== "table" && drawing.kind !== "chart") return null;
  const { settings, width, height } = drawing.source;
  const source: PresentationInsertedSource = { kind: drawing.kind, data: { settings, width, height } };
  return byteLength(JSON.stringify({ v: SOURCE_VERSION, ...source })) <= MAX_SOURCE_BYTES ? source : null;
}

function storedData(data: Record<string, unknown>): StoredData | null {
  const { settings, width, height } = data;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return null;
  return { settings: settings as Record<string, unknown>, width, height };
}

export function drawingOfInserted(item: PresentationInsertedItem): Extract<DrawingSource, { kind: PresentationInsertedItem["kind"] }> | null {
  const data = storedData(item.data);
  if (!data) return null;
  const { settings, width, height } = data;
  if (item.kind === "table") {
    if (!Array.isArray(settings.cells) || !Array.isArray(settings.align)) return null;
    return { kind: "table", source: { settings: settings as unknown as TableSettings, svg: "", width, height } };
  }
  if (typeof settings.type !== "string") return null;
  return { kind: "chart", source: { settings: settings as unknown as ChartSettings, svg: "", width, height } };
}

export function insertedItemAt(items: readonly PresentationInsertedItem[], point: { x: number; y: number }): PresentationInsertedItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const [x0, y0, x1, y1] = items[index].rect;
    if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) return items[index];
  }
  return null;
}
