const LAST_SEEN_KEY = "vivepdf.lastSeenVersion";

function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function readLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function storeLastSeenVersion(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    void 0;
  }
}

export function takeUpdateAnnouncement(current: string): boolean {
  const lastSeen = readLastSeenVersion();
  const upgraded = lastSeen !== null && compareVersions(current, lastSeen) > 0;
  if (lastSeen === null || compareVersions(current, lastSeen) !== 0) storeLastSeenVersion(current);
  return upgraded;
}
