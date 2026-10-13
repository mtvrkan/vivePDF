type HistorySteps = { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean };
type AnnotationLookup = { getAnnotationById: (id: string) => unknown };
type Replacement = { removedId: string; addedId: string };

const MAX_LINKS = 100;
const links = new Map<string, Replacement[]>();

export function linkReplacement(documentId: string, removedId: string, addedId: string): void {
  links.set(documentId, [...(links.get(documentId) ?? []), { removedId, addedId }].slice(-MAX_LINKS));
}

export function forgetReplacements(documentId: string): void {
  links.delete(documentId);
}

function present(lookup: AnnotationLookup, id: string): boolean {
  return Boolean(lookup.getAnnotationById(id));
}

function step(documentId: string, history: HistorySteps | null | undefined, lookup: AnnotationLookup | null | undefined, direction: "undo" | "redo"): void {
  if (!history) return;
  const before = lookup ? (links.get(documentId) ?? []).filter((link) => present(lookup, direction === "undo" ? link.addedId : link.removedId)) : [];
  history[direction]();
  if (!lookup || !before.some((link) => !present(lookup, link.removedId) && !present(lookup, link.addedId))) return;
  if (direction === "undo" ? history.canUndo() : history.canRedo()) history[direction]();
}

export function undoStep(documentId: string, history: HistorySteps | null | undefined, lookup: AnnotationLookup | null | undefined): void {
  step(documentId, history, lookup, "undo");
}

export function redoStep(documentId: string, history: HistorySteps | null | undefined, lookup: AnnotationLookup | null | undefined): void {
  step(documentId, history, lookup, "redo");
}
