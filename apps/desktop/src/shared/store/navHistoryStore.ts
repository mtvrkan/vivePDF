import { create } from "zustand";

export type NavStacks = { back: number[]; forward: number[] };

const HISTORY_LIMIT = 50;
const EMPTY: NavStacks = { back: [], forward: [] };

export function recordVisit(stacks: NavStacks, fromPage: number, toPage: number): NavStacks {
  if (fromPage === toPage) return stacks;
  const back = stacks.back.at(-1) === fromPage ? stacks.back : [...stacks.back, fromPage].slice(-HISTORY_LIMIT);
  return { back, forward: [] };
}

export function stepBack(stacks: NavStacks, currentPage: number): { stacks: NavStacks; page: number } | null {
  const page = stacks.back.at(-1);
  if (page === undefined) return null;
  return { page, stacks: { back: stacks.back.slice(0, -1), forward: [...stacks.forward, currentPage].slice(-HISTORY_LIMIT) } };
}

export function stepForward(stacks: NavStacks, currentPage: number): { stacks: NavStacks; page: number } | null {
  const page = stacks.forward.at(-1);
  if (page === undefined) return null;
  return { page, stacks: { back: [...stacks.back, currentPage].slice(-HISTORY_LIMIT), forward: stacks.forward.slice(0, -1) } };
}

type NavHistoryState = {
  stacks: Record<string, NavStacks>;
  record: (documentId: string, fromPage: number, toPage: number) => void;
  back: (documentId: string, currentPage: number) => number | null;
  forward: (documentId: string, currentPage: number) => number | null;
  clear: (documentId: string) => void;
};

export const useNavHistoryStore = create<NavHistoryState>((set, get) => {
  const move = (documentId: string, currentPage: number, step: typeof stepBack) => {
    const result = step(get().stacks[documentId] ?? EMPTY, currentPage);
    if (!result) return null;
    set((state) => ({ stacks: { ...state.stacks, [documentId]: result.stacks } }));
    return result.page;
  };
  return {
    stacks: {},
    record: (documentId, fromPage, toPage) =>
      set((state) => ({ stacks: { ...state.stacks, [documentId]: recordVisit(state.stacks[documentId] ?? EMPTY, fromPage, toPage) } })),
    back: (documentId, currentPage) => move(documentId, currentPage, stepBack),
    forward: (documentId, currentPage) => move(documentId, currentPage, stepForward),
    clear: (documentId) =>
      set((state) => {
        const stacks = { ...state.stacks };
        delete stacks[documentId];
        return { stacks };
      }),
  };
});

export function navStacksFor(stacks: Record<string, NavStacks>, documentId: string): NavStacks {
  return stacks[documentId] ?? EMPTY;
}
