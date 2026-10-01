export type FormulaSource = { latex: string; svg: string; color: string; emWidth: number; emHeight: number };

export const DEFAULT_FORMULA_COLOR = "#111111";
export const DEFAULT_FORMULA_SIZE = 18;
export const MIN_FORMULA_SIZE = 6;
export const MAX_FORMULA_SIZE = 144;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TABLE_LINE = /<(line|rect)\b([^>]*\bdata-(?:line|frame)="[^"]*"[^>]*?)\s*\/>/g;
const TABLE_LINE_WIDTH = 70;
const TABLE_DASH = 140;

function numberAttribute(attributes: string, name: string): number {
  const match = new RegExp(`\\s${name}="([^"]+)"`).exec(attributes);
  return match ? Number(match[1]) : Number.NaN;
}

function dashedLinePath(x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return `M${x1} ${y1}L${x2} ${y2}`;
  const [dx, dy] = [(x2 - x1) / length, (y2 - y1) / length];
  const parts: string[] = [];
  for (let start = 0; start < length; start += dash + gap) {
    const end = Math.min(length, start + dash);
    const point = (distance: number) => `${round(x1 + dx * distance)} ${round(y1 + dy * distance)}`;
    parts.push(`M${point(start)}L${point(end)}`);
  }
  return parts.join("");
}

export function standaloneTableLines(svg: string): string {
  return svg.replace(TABLE_LINE, (_match, tag: string, attributes: string) => {
    const pattern = /\sclass="[^"]*\bmjx-(dashed|dotted)\b/.exec(attributes)?.[1];
    if (tag === "line" && pattern) {
      const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((name) => numberAttribute(attributes, name));
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        const d = pattern === "dashed" ? dashedLinePath(x1, y1, x2, y2, TABLE_DASH, TABLE_DASH) : dashedLinePath(x1, y1, x2, y2, 1, TABLE_DASH - 1);
        return `<path d="${d}" stroke-width="${TABLE_LINE_WIDTH}" fill="none" stroke-linecap="round"/>`;
      }
    }
    return `<${tag}${attributes} stroke-width="${TABLE_LINE_WIDTH}" fill="none"/>`;
  });
}

export function coloredFormulaSvg(svg: string, color: string): string {
  const paint = HEX_COLOR.test(color) ? color : DEFAULT_FORMULA_COLOR;
  return svg.replace(/^<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:style|width|height)="[^"]*"/g, "")).replaceAll("currentColor", paint);
}

export function formulaDataUrl(source: Pick<FormulaSource, "svg" | "color" | "emWidth" | "emHeight">): string {
  const sized = coloredFormulaSvg(source.svg, source.color).replace(/^<svg\b/, `<svg width="${round(source.emWidth * 100)}" height="${round(source.emHeight * 100)}"`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

export function formulaBox(source: Pick<FormulaSource, "emWidth" | "emHeight">, size: number): { width: number; height: number } {
  return { width: source.emWidth * size, height: source.emHeight * size };
}

export function formulaSizeOf(source: Pick<FormulaSource, "emWidth">, width: number): number {
  if (source.emWidth <= 0) return DEFAULT_FORMULA_SIZE;
  return clampFormulaSize(width / source.emWidth);
}

export function clampFormulaSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FORMULA_SIZE;
  return Math.round(Math.min(MAX_FORMULA_SIZE, Math.max(MIN_FORMULA_SIZE, value)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
