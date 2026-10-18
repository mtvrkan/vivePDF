export const STAMP_CHECK_MS = 1500;

export function createThumbnailStamps(now: () => number = () => Date.now()) {
  const stamps = new Map<string, string>();
  const generations = new Map<string, number>();
  const checkedAt = new Map<string, number>();
  const listeners = new Set<() => void>();

  const generation = (path: string) => generations.get(path) ?? 0;

  const note = (path: string, stamp: string | undefined) => {
    checkedAt.set(path, now());
    if (!stamp) return;
    const known = stamps.get(path);
    stamps.set(path, stamp);
    if (known === undefined || known === stamp) return;
    generations.set(path, generation(path) + 1);
    listeners.forEach((listener) => listener());
  };

  const needsCheck = (path: string) => {
    const last = checkedAt.get(path);
    if (last !== undefined && now() - last < STAMP_CHECK_MS) return false;
    checkedAt.set(path, now());
    return true;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { generation, note, needsCheck, subscribe };
}
