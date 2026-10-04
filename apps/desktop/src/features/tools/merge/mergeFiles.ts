const DRIVE = /^[a-zA-Z]:$/;

function looksLikeWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:/.test(path) || path.includes("\\");
}

export function comparablePath(path: string): string {
  const trimmed = path.trim();
  const unified = trimmed.replace(/\\/g, "/");
  const prefix = unified.startsWith("//") ? "//" : unified.startsWith("/") ? "/" : "";
  const parts = unified.split("/").filter((part) => part !== "" && part !== ".");
  const rootParts = DRIVE.test(parts[0] ?? "") ? 1 : prefix === "//" ? 2 : 0;
  const kept: string[] = [];
  for (const part of parts) {
    if (part !== "..") kept.push(part);
    else if (kept.length > rootParts) kept.pop();
  }
  const joined = `${prefix}${kept.join("/")}`;
  return looksLikeWindowsPath(trimmed) ? joined.toLowerCase() : joined;
}

export function withoutListed(listed: readonly string[], incoming: readonly string[]): { fresh: string[]; repeated: number } {
  const seen = new Set(listed.map(comparablePath));
  const fresh: string[] = [];
  let repeated = 0;
  for (const path of incoming) {
    const key = comparablePath(path);
    if (seen.has(key)) {
      repeated += 1;
      continue;
    }
    seen.add(key);
    fresh.push(path);
  }
  return { fresh, repeated };
}
