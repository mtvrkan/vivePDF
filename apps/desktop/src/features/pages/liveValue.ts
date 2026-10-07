export type LiveValue<T> = {
  get: () => T | null;
  set: (next: T | null) => void;
  subscribe: (listener: (value: T | null) => void) => () => void;
};

export function createLiveValue<T>(): LiveValue<T> {
  let value: T | null = null;
  const listeners = new Set<(value: T | null) => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of listeners) listener(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(value);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
