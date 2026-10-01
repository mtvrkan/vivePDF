import { create } from "zustand";

type LaunchState = {
  pendingPath: string | null;
  pendingPaths: string[];
  pendingRoute: string | null;
  setPending: (path: string | null, route?: string | null) => void;
  setPendingPaths: (paths: string[]) => void;
  consumeIf: (predicate: (path: string) => boolean, pathname?: string) => string | null;
  consumeAll: (predicate: (path: string) => boolean, pathname?: string) => string[];
};

function pathOf(route: string): string {
  return route.split("?")[0];
}

function meantFor(route: string | null, pathname: string | undefined): boolean {
  return !route || pathname === undefined || pathOf(route) === pathname;
}

export const useLaunchStore = create<LaunchState>((set, get) => ({
  pendingPath: null,
  pendingPaths: [],
  pendingRoute: null,
  setPending: (path, route = null) => set({ pendingPath: path, pendingRoute: path ? route : null }),
  setPendingPaths: (paths) => set({ pendingPaths: paths }),
  consumeIf: (predicate, pathname) => {
    const { pendingPath, pendingRoute } = get();
    if (!pendingPath || !predicate(pendingPath) || !meantFor(pendingRoute, pathname)) return null;
    set({ pendingPath: null, pendingPaths: [], pendingRoute: null });
    return pendingPath;
  },
  consumeAll: (predicate, pathname) => {
    const { pendingPaths, pendingRoute } = get();
    const matching = pendingPaths.filter(predicate);
    if (matching.length === 0 || !meantFor(pendingRoute, pathname)) return [];
    set({ pendingPath: null, pendingPaths: [], pendingRoute: null });
    return matching;
  },
}));
