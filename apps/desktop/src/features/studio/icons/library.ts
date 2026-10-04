import icons from "virtual:studio-icons";
import type { StudioVectorPath } from "@/types/studio";
import { iconArt, type IconArt, type IconNode } from "./iconArt";
import { iconEntry, searchIcons, type IconEntry, type IconSearchOptions } from "./iconSearch";

const nodes = new Map<string, IconNode>(icons);
const previews = new Map<string, StudioVectorPath[]>();

export const ICON_ENTRIES: IconEntry[] = icons.map(([name]) => iconEntry(name));

export function iconArtOf(name: string, color: string): IconArt | null {
  const node = nodes.get(name);
  return node ? iconArt(node, color) : null;
}

export function findIcons(query: string, options: IconSearchOptions = {}): IconEntry[] {
  return searchIcons(ICON_ENTRIES, query, options);
}

export function iconPreview(name: string): StudioVectorPath[] {
  let paths = previews.get(name);
  if (!paths) {
    const node = nodes.get(name);
    paths = node ? iconArt(node, "currentColor").paths : [];
    previews.set(name, paths);
  }
  return paths;
}
