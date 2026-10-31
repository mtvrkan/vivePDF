export type Size = { width: number; height: number };

export const PRINT_DPI = 150;
export const PRINT_SCALE = PRINT_DPI / 72;
export const PRINT_ROOT_CLASS = "vivepdf-print-root";

const A4: Size = { width: 595, height: 842 };

function usable(size: Size | undefined): size is Size {
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

export function sheetSize(first: Size | undefined): Size {
  return usable(first) ? { width: first.width, height: first.height } : A4;
}

export function fitInto(page: Size, sheet: Size): Size {
  if (!usable(page)) return sheet;
  const ratio = Math.min(sheet.width / page.width, sheet.height / page.height);
  return { width: page.width * ratio, height: page.height * ratio };
}

export function printSheetCss(sheet: Size): string {
  const root = `.${PRINT_ROOT_CLASS}`;
  return [
    `@media screen { ${root} { display: none !important; } }`,
    "@media print {",
    `@page { size: ${sheet.width}pt ${sheet.height}pt; margin: 0; }`,
    "html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; background: transparent !important; }",
    `body > :not(${root}) { display: none !important; }`,
    `${root} { display: block !important; margin: 0; padding: 0; }`,
    `${root} > div { display: flex; align-items: center; justify-content: center; width: ${sheet.width}pt; height: ${sheet.height}pt; overflow: hidden; break-inside: avoid; }`,
    `${root} > div + div { break-before: page; }`,
    `${root} img { display: block; }`,
    "}",
  ].join("\n");
}
