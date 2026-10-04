import icons from "virtual:studio-icons";
import type { StudioVectorPath } from "@/types/studio";
import { iconArt, type IconNode } from "./iconArt";
import { iconEntry, type IconEntry } from "./iconSearch";

const nodes = new Map<string, IconNode>(icons);
const previews = new Map<string, StudioVectorPath[]>();

export const ICON_ENTRIES: IconEntry[] = icons.map(([name]) => iconEntry(name));

export function iconNodeOf(name: string): IconNode | null {
  return nodes.get(name) ?? null;
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
