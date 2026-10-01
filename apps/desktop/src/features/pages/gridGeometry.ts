export type GridBox = { left: number; top: number; width: number; height: number };

export type GridMetrics = {
  count: number;
  width: number;
  columns: number;
  columnWidth: number;
  rowHeight: number;
  gap: number;
};

export type TileRange = { start: number; end: number };

export function columnCount(width: number, minColumnWidth: number, gap: number): number {
  if (width <= 0 || minColumnWidth <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
}

export function gridMetrics(count: number, width: number, minColumnWidth: number, rowHeight: number, gap: number): GridMetrics {
  const columns = columnCount(width, minColumnWidth, gap);
  const columnWidth = Math.max(minColumnWidth, (width - (columns - 1) * gap) / columns);
  return { count, width, columns, columnWidth, rowHeight, gap };
}

export function rowStride(metrics: GridMetrics): number {
  return metrics.rowHeight + metrics.gap;
}

export function rowCount(metrics: GridMetrics): number {
  return Math.ceil(metrics.count / metrics.columns);
}

export function gridHeight(metrics: GridMetrics): number {
  const rows = rowCount(metrics);
  return rows === 0 ? 0 : rows * rowStride(metrics) - metrics.gap;
}

export function tileBox(metrics: GridMetrics, index: number): GridBox {
  const row = Math.floor(index / metrics.columns);
  const column = index % metrics.columns;
  return { left: column * (metrics.columnWidth + metrics.gap), top: row * rowStride(metrics), width: metrics.columnWidth, height: metrics.rowHeight };
}

export function rowsRange(metrics: GridMetrics, top: number, bottom: number, overscan: number): TileRange {
  const rows = rowCount(metrics);
  if (rows === 0 || bottom <= top) return { start: 0, end: 0 };
  const stride = rowStride(metrics);
  const firstRow = Math.max(0, Math.floor(top / stride) - overscan);
  const lastRow = Math.min(rows - 1, Math.floor(bottom / stride) + overscan);
  if (firstRow > lastRow) return { start: 0, end: 0 };
  return { start: firstRow * metrics.columns, end: Math.min(metrics.count, (lastRow + 1) * metrics.columns) };
}

export function mirrorBox(metrics: GridMetrics, box: GridBox): GridBox {
  return { ...box, left: metrics.width - box.left - box.width };
}

export function indexesNear(metrics: GridMetrics, box: GridBox): number[] {
  if (metrics.count === 0 || box.width < 0 || box.height < 0) return [];
  const stride = rowStride(metrics);
  const columnStride = metrics.columnWidth + metrics.gap;
  const firstRow = Math.max(0, Math.floor(box.top / stride));
  const lastRow = Math.min(rowCount(metrics) - 1, Math.floor((box.top + box.height) / stride));
  const firstColumn = Math.max(0, Math.floor(box.left / columnStride));
  const lastColumn = Math.min(metrics.columns - 1, Math.floor((box.left + box.width) / columnStride));
  const indexes: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const index = row * metrics.columns + column;
      if (index >= metrics.count) break;
      indexes.push(index);
    }
  }
  return indexes;
}

export function dropIndexAt(metrics: GridMetrics, x: number, y: number): number {
  if (metrics.count === 0) return 0;
  const rows = rowCount(metrics);
  const stride = rowStride(metrics);
  const columnStride = metrics.columnWidth + metrics.gap;
  const row = Math.max(0, Math.min(rows - 1, Math.floor((y + metrics.gap / 2) / stride)));
  const rowStart = row * metrics.columns;
  const rowLength = Math.min(metrics.columns, metrics.count - rowStart);
  const column = Math.max(0, Math.min(rowLength - 1, Math.floor((x + metrics.gap / 2) / columnStride)));
  const center = column * columnStride + metrics.columnWidth / 2;
  const index = rowStart + column;
  return x < center ? index : index + 1;
}

export function revealOffset(viewTop: number, viewHeight: number, itemTop: number, itemHeight: number, margin: number): number | null {
  if (itemTop - margin < viewTop) return Math.max(0, itemTop - margin);
  if (itemTop + itemHeight + margin > viewTop + viewHeight) return itemTop + itemHeight + margin - viewHeight;
  return null;
}
