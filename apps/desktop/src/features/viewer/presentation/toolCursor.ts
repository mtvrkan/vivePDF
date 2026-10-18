const PEN_PATHS = [
  "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
  "m15 5 4 4",
];
const HIGHLIGHTER_PATHS = ["m9 11-6 6v3h9l3-3", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"];
const ERASER_PATHS = ["m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21", "M22 21H7", "m5 11 9 9"];

export const TOOL_CURSOR_SIZE = 28;
export const ERASER_CURSOR_COLOR = "#1f2937";

export type ToolCursorArt = { src: string; hotX: number; hotY: number };

function cursorArt(paths: string[], color: string, hotX: number, hotY: number): ToolCursorArt {
  const shapes = paths.map((path) => `<path d="${path}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TOOL_CURSOR_SIZE}" height="${TOOL_CURSOR_SIZE}" viewBox="-2 -2 28 28" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="#ffffff" stroke-width="4.5" stroke-opacity="0.95">${shapes}</g>` +
    `<g stroke="${color}" stroke-width="2">${shapes}</g>` +
    `</svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, hotX, hotY };
}

function cssCursor(art: ToolCursorArt): string {
  return `url("${art.src}") ${art.hotX} ${art.hotY}, crosshair`;
}

export function penCursorArt(color: string): ToolCursorArt {
  return cursorArt(PEN_PATHS, color, 4, 24);
}

export function highlighterCursorArt(color: string): ToolCursorArt {
  return cursorArt(HIGHLIGHTER_PATHS, color, 4, 24);
}

export function eraserCursorArt(color: string): ToolCursorArt {
  return cursorArt(ERASER_PATHS, color, 8, 24);
}

export function penCursor(color: string): string {
  return cssCursor(penCursorArt(color));
}

export function highlighterCursor(color: string): string {
  return cssCursor(highlighterCursorArt(color));
}

export function eraserCursor(color: string): string {
  return cssCursor(eraserCursorArt(color));
}
