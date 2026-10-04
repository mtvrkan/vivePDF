import { useCallback, useEffect, useState } from "react";

export type IconLibrary = typeof import("./library");

export type IconLibraryState = { status: "idle" | "loading" } | { status: "ready"; library: IconLibrary } | { status: "error" };

let pending: Promise<IconLibrary> | null = null;
let loaded: IconLibrary | null = null;

export function loadIconLibrary(): Promise<IconLibrary> {
  pending ??= import("./library").then(
    (library) => {
      loaded = library;
      return library;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

export function useIconLibrary(enabled: boolean): { state: IconLibraryState; retry: () => void } {
  const [state, setState] = useState<IconLibraryState>(() => (loaded ? { status: "ready", library: loaded } : { status: "idle" }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || loaded) {
      if (loaded) setState((current) => (current.status === "ready" ? current : { status: "ready", library: loaded as IconLibrary }));
      return;
    }
    let active = true;
    setState({ status: "loading" });
    loadIconLibrary().then(
      (library) => {
        if (active) setState({ status: "ready", library });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}
