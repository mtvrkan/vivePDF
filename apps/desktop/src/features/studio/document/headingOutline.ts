import type { Node as ProseNode } from "@tiptap/pm/model";

export type OutlineHeading = { position: number; level: number; text: string };

const MAX_LEVEL = 4;

export function headingOutline(doc: ProseNode): OutlineHeading[] {
  const outline: OutlineHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "heading") return true;
    outline.push({ position, level: Math.min(MAX_LEVEL, Math.max(1, Number(node.attrs.level) || 1)), text: node.textContent.trim() });
    return false;
  });
  return outline;
}

export function currentHeadingIndex(outline: OutlineHeading[], head: number): number {
  let current = -1;
  outline.forEach((heading, index) => {
    if (heading.position < head) current = index;
  });
  return current;
}

export function hasChildren(outline: OutlineHeading[], index: number): boolean {
  const next = outline[index + 1];
  return next !== undefined && next.level > outline[index].level;
}

export function visibleHeadings(outline: OutlineHeading[], collapsed: ReadonlySet<number>): number[] {
  const shown: number[] = [];
  let hiddenAbove: number | null = null;
  outline.forEach((heading, index) => {
    if (hiddenAbove !== null && heading.level > hiddenAbove) return;
    hiddenAbove = collapsed.has(index) ? heading.level : null;
    shown.push(index);
  });
  return shown;
}
