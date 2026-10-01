const TOKEN = /\{([^{}]*)\}/g;

export function unknownTokens(pattern: string, known: readonly string[]): string[] {
  const found: string[] = [];
  for (const match of pattern.matchAll(TOKEN)) {
    const name = match[1].trim();
    if (!name || known.includes(name) || found.includes(name)) continue;
    found.push(name);
  }
  return found;
}

export function renamedPaths(paths: string[], results: Array<{ path: string; output: string | null; ok: boolean }>): string[] {
  const moved = new Map(results.filter((entry) => entry.ok && entry.output).map((entry) => [entry.path, entry.output as string]));
  return paths.map((path) => moved.get(path) ?? path);
}
