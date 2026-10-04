import type { StudioElement, StudioElementKind, StudioPage } from "@/types/studio";
import { deepEqual } from "./multiEdit";
import { withElementStyle, type StylePatch } from "./richText";

export type ElementStyle = { kind: StudioElementKind; values: Record<string, unknown> };

const LAYOUT_KEYS = ["id", "name", "kind", "x", "y", "width", "height", "rotation", "locked", "hidden", "groupId", "flipX", "flipY"] as const;

const OPTIONAL_KEYS: Partial<Record<StudioElementKind, readonly string[]>> = { image: ["filters"] };

const CONTENT_KEYS: Record<StudioElementKind, readonly string[]> = {
  text: ["runs", "paragraphs"],
  shape: ["shape", "points", "innerRatio"],
  image: ["src", "crop"],
  qr: ["value", "errorLevel"],
  vector: ["paths", "viewWidth", "viewHeight"],
  svg: ["svg", "source", "data"],
};

const RUN_KEYS = ["bold", "italic", "underline", "strike", "color", "fontId", "weight"] as const;

export function extractStyle(element: StudioElement): ElementStyle {
  const skipped = new Set<string>([...LAYOUT_KEYS, ...CONTENT_KEYS[element.kind]]);
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(element).filter(([key]) => !skipped.has(key) && (element as Record<string, unknown>)[key] !== undefined));
  for (const key of OPTIONAL_KEYS[element.kind] ?? []) if (!(key in values)) values[key] = null;
  return { kind: element.kind, values: structuredClone(values) };
}

function compatible(current: unknown, incoming: unknown): boolean {
  if (current === null || incoming === null) return true;
  if (Array.isArray(current) !== Array.isArray(incoming)) return false;
  return typeof current === typeof incoming;
}

export function applyStyle(element: StudioElement, style: ElementStyle): StudioElement {
  const skipped = new Set<string>([...LAYOUT_KEYS, ...CONTENT_KEYS[element.kind]]);
  const target = element as Record<string, unknown>;
  const optional = new Set(OPTIONAL_KEYS[element.kind] ?? []);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style.values)) {
    if (optional.has(key) && value === null) {
      if (target[key] !== undefined) patch[key] = undefined;
      continue;
    }
    const fresh = optional.has(key) && target[key] === undefined;
    if (skipped.has(key) || (!(key in target) && !fresh) || (!fresh && !compatible(target[key], value)) || deepEqual(target[key], value)) continue;
    patch[key] = structuredClone(value);
  }
  const next = Object.keys(patch).length ? ({ ...element, ...patch } as StudioElement) : element;
  if (next.kind !== "text" || style.kind !== "text") return next;
  const runPatch: StylePatch = {};
  for (const key of RUN_KEYS) if (key in style.values) Object.assign(runPatch, { [key]: next[key] });
  if (!Object.keys(runPatch).length) return next;
  const styled = withElementStyle(next, runPatch);
  return deepEqual(styled, element) ? element : styled;
}

export function applyStyleToPage(page: StudioPage, ids: readonly string[], style: ElementStyle): StudioPage {
  const chosen = new Set(ids);
  let changed = false;
  const elements = page.elements.map((element) => {
    if (!chosen.has(element.id) || element.locked) return element;
    const next = applyStyle(element, style);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? { ...page, elements } : page;
}
