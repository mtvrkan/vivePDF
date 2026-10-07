import type { AssemblePage, AssembleSource, OrganizerSource, OrganizerTile } from "@/types";
import { MAIN_SOURCE_ID } from "./organizerStore";

export type Arrangement = { sources: AssembleSource[]; pages: AssemblePage[] };

export function arrangementOf(
  chosen: readonly OrganizerTile[],
  sources: Record<string, OrganizerSource>,
  main: { path: string; password: string | null },
  { mainFirst = false }: { mainFirst?: boolean } = {},
): Arrangement {
  const usedSources = new Set(chosen.filter((tile): tile is Extract<OrganizerTile, { kind: "page" }> => tile.kind === "page").map((tile) => tile.sourceId));
  if (mainFirst) usedSources.add(MAIN_SOURCE_ID);
  const assembleSources: AssembleSource[] = Object.values(sources)
    .filter((source) => usedSources.has(source.id))
    .sort((left, right) => (mainFirst ? Number(right.id === MAIN_SOURCE_ID) - Number(left.id === MAIN_SOURCE_ID) : 0))
    .map((source) => ({ id: source.id, path: source.path, password: source.password ?? undefined }));
  const pages: AssemblePage[] = chosen.map((tile) =>
    tile.kind === "page"
      ? { kind: "page", source: tile.sourceId, index: tile.index, rotate: tile.rotate }
      : tile.kind === "blank"
        ? { kind: "blank", width: tile.width, height: tile.height, rotate: tile.rotate, ...(tile.paper ? { paper: tile.paper } : {}) }
        : { kind: "image", path: tile.path, rotate: tile.rotate },
  );
  const fallback: AssembleSource = { id: MAIN_SOURCE_ID, path: main.path, password: main.password ?? undefined };
  const withMain = mainFirst && assembleSources[0]?.id !== MAIN_SOURCE_ID ? [fallback, ...assembleSources] : assembleSources;
  return { sources: withMain.length > 0 ? withMain : [fallback], pages };
}
