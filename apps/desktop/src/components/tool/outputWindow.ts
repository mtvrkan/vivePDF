export const WINDOW_FROM = 100;
export const OVERSCAN = 8;

export type OutputWindow = { start: number; end: number; paddingTop: number; paddingBottom: number };

export function outputWindow(count: number, scrollTop: number, viewport: number, rowHeight: number): OutputWindow {
  if (count < WINDOW_FROM) return { start: 0, end: count, paddingTop: 0, paddingBottom: 0 };
  if (rowHeight <= 0 || viewport <= 0) return { start: 0, end: WINDOW_FROM, paddingTop: 0, paddingBottom: 0 };
  const visible = Math.ceil(viewport / rowHeight);
  const first = Math.min(Math.floor(Math.max(0, scrollTop) / rowHeight), Math.max(0, count - visible));
  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(count, first + visible + OVERSCAN);
  return { start, end, paddingTop: start * rowHeight, paddingBottom: (count - end) * rowHeight };
}

export function visibleSpan(listTop: number, listBottom: number, listScrollTop: number, screenHeight: number): { scrollTop: number; viewport: number } {
  const top = Math.min(Math.max(listTop, 0), listBottom);
  const bottom = Math.max(Math.min(listBottom, screenHeight), top);
  return { scrollTop: top - (listTop - listScrollTop), viewport: Math.max(bottom - top, 1) };
}
