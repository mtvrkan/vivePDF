import type { DocumentNode } from "@/types/studio";

export const EQUATION = "equation";
export const EQUATION_BLOCK = "equationBlock";
export const EQUATION_REF = "equationRef";
export const EQUATION_VERSION = 4;
export const EQUATION_COLOUR = "#000000";
export const MAX_EQUATIONS = 1000;
export const MAX_EQUATION_SVG = 400_000;
export const MAX_EQUATION_LATEX = 4000;
export const MAX_EQUATION_EM = 60;
export const MISSING_EQUATION = "(?)";

const SVG_START = /^<svg[\s>]/;
const EQUATION_ID = /^[a-z0-9-]{1,40}$/i;

export type EquationArt = { latex: string; svg: string; width: number; height: number; depth: number };

function size(value: unknown, minimum: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= MAX_EQUATION_EM ? number : null;
}

export function equationArt(attrs: Record<string, unknown> | undefined): EquationArt | null {
  const latex = typeof attrs?.latex === "string" ? attrs.latex : "";
  const svg = typeof attrs?.svg === "string" ? attrs.svg : "";
  const width = size(attrs?.width, Number.MIN_VALUE);
  const height = size(attrs?.height, Number.MIN_VALUE);
  const depth = size(attrs?.depth, 0) ?? 0;
  if (!latex.trim() || latex.length > MAX_EQUATION_LATEX || !SVG_START.test(svg) || svg.length > MAX_EQUATION_SVG || width === null || height === null) return null;
  return { latex, svg, width, height, depth: Math.min(depth, height) };
}

export function equationId(value: unknown): string | null {
  return typeof value === "string" && EQUATION_ID.test(value) ? value : null;
}

export function newEquationId(): string {
  return `eq-${crypto.randomUUID().slice(0, 8)}`;
}

export function equationLabel(number: number | undefined): string {
  return number ? `(${number})` : MISSING_EQUATION;
}

function visit(node: DocumentNode, found: (node: DocumentNode) => void): void {
  found(node);
  for (const child of node.content ?? []) visit(child, found);
}

export function equationNumbers(content: DocumentNode): Map<string, number> {
  const numbers = new Map<string, number>();
  let count = 0;
  visit(content, (node) => {
    if (node.type !== EQUATION_BLOCK || !equationArt(node.attrs)) return;
    count += 1;
    const id = equationId(node.attrs?.id);
    if (id && !numbers.has(id)) numbers.set(id, count);
  });
  return numbers;
}

export function hasEquations(content: DocumentNode | string): boolean {
  if (typeof content === "string") return false;
  let found = false;
  visit(content, (node) => {
    if (node.type === EQUATION || node.type === EQUATION_BLOCK || node.type === EQUATION_REF) found = true;
  });
  return found;
}
