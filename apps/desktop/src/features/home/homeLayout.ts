import { homeQuickActionIds } from "@/app/navigation";

export const HOME_SECTION_IDS = ["hero", "quickActions", "recent", "studio", "collections", "tools", "continue", "history", "stats"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];
export const HOME_REGIONS = ["top", "main", "side", "bottom"] as const;
export type HomeRegion = (typeof HOME_REGIONS)[number];
export const HOME_SIZES = ["small", "medium", "large"] as const;
export type HomeSize = (typeof HOME_SIZES)[number];
export const SIDEBAR_SIDES = ["start", "end"] as const;
export type SidebarSide = (typeof SIDEBAR_SIDES)[number];
export const SIDEBAR_WIDTHS = ["narrow", "normal", "wide"] as const;
export type SidebarWidth = (typeof SIDEBAR_WIDTHS)[number];
export const MAX_QUICK_ACTIONS = 18;

export type HomeSectionLayout = { id: HomeSectionId; region: HomeRegion; size: HomeSize; hidden: boolean };
export type HomeLayout = {
  sections: HomeSectionLayout[];
  sidebar: { side: SidebarSide; width: SidebarWidth };
  quickActions: string[];
};


export function defaultHomeLayout(): HomeLayout {
  return {
    sections: [
      { id: "hero", region: "main", size: "medium", hidden: false },
      { id: "quickActions", region: "main", size: "medium", hidden: false },
      { id: "recent", region: "main", size: "medium", hidden: false },
      { id: "studio", region: "main", size: "medium", hidden: false },
      { id: "collections", region: "main", size: "medium", hidden: false },
      { id: "tools", region: "main", size: "medium", hidden: false },
      { id: "continue", region: "side", size: "medium", hidden: false },
      { id: "history", region: "side", size: "medium", hidden: false },
      { id: "stats", region: "side", size: "medium", hidden: false },
    ],
    sidebar: { side: "end", width: "normal" },
    quickActions: [...homeQuickActionIds],
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeHomeLayout(raw: unknown, knownTools: ReadonlySet<string>): HomeLayout {
  const fallback = defaultHomeLayout();
  if (typeof raw !== "object" || raw === null) return fallback;
  const stored = raw as Record<string, unknown>;
  const seen = new Set<HomeSectionId>();
  const sections: HomeSectionLayout[] = [];
  for (const item of Array.isArray(stored.sections) ? stored.sections : []) {
    const entry = item as Record<string, unknown> | null;
    const id = entry?.id as HomeSectionId;
    if (!HOME_SECTION_IDS.includes(id) || seen.has(id)) continue;
    const base = fallback.sections.find((section) => section.id === id) as HomeSectionLayout;
    seen.add(id);
    sections.push({
      id,
      region: oneOf(entry?.region, HOME_REGIONS, base.region),
      size: oneOf(entry?.size, HOME_SIZES, base.size),
      hidden: entry?.hidden === true,
    });
  }
  for (const section of fallback.sections) if (!seen.has(section.id)) sections.push(section);
  const sidebar = (stored.sidebar ?? {}) as Record<string, unknown>;
  const quick = Array.isArray(stored.quickActions)
    ? [...new Set(stored.quickActions.filter((id): id is string => typeof id === "string" && knownTools.has(id)))].slice(0, MAX_QUICK_ACTIONS)
    : fallback.quickActions;
  return {
    sections,
    sidebar: { side: oneOf(sidebar.side, SIDEBAR_SIDES, fallback.sidebar.side), width: oneOf(sidebar.width, SIDEBAR_WIDTHS, fallback.sidebar.width) },
    quickActions: quick,
  };
}

export function sectionsIn(layout: HomeLayout, region: HomeRegion, includeHidden = false): HomeSectionLayout[] {
  return layout.sections.filter((section) => section.region === region && (includeHidden || !section.hidden));
}

export function hiddenSections(layout: HomeLayout): HomeSectionLayout[] {
  return layout.sections.filter((section) => section.hidden);
}

export function moveSection(layout: HomeLayout, id: HomeSectionId, region: HomeRegion, index: number): HomeLayout {
  const moving = layout.sections.find((section) => section.id === id);
  if (!moving) return layout;
  const from = sectionsIn(layout, region).findIndex((section) => section.id === id);
  const slot = from >= 0 && index > from ? index - 1 : index;
  const rest = layout.sections.filter((section) => section.id !== id);
  const targets = rest.filter((section) => section.region === region && !section.hidden);
  const clamped = Math.max(0, Math.min(targets.length, slot));
  const moved = { ...moving, region, hidden: false };
  let insertAt: number;
  if (clamped < targets.length) insertAt = rest.indexOf(targets[clamped]);
  else if (targets.length > 0) insertAt = rest.indexOf(targets[targets.length - 1]) + 1;
  else insertAt = rest.length;
  const sections = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  const unchanged = sections.every((section, position) => section.id === layout.sections[position].id && section.region === layout.sections[position].region && section.hidden === layout.sections[position].hidden);
  return unchanged ? layout : { ...layout, sections };
}

export function shiftSection(layout: HomeLayout, id: HomeSectionId, delta: number): HomeLayout {
  const section = layout.sections.find((item) => item.id === id);
  if (!section) return layout;
  const visible = sectionsIn(layout, section.region);
  const index = visible.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= visible.length) return layout;
  return moveSection(layout, id, section.region, delta > 0 ? target + 1 : target);
}

export function updateSection(layout: HomeLayout, id: HomeSectionId, patch: Partial<Omit<HomeSectionLayout, "id">>): HomeLayout {
  return { ...layout, sections: layout.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)) };
}

export function withQuickAction(layout: HomeLayout, toolId: string): HomeLayout {
  if (layout.quickActions.includes(toolId) || layout.quickActions.length >= MAX_QUICK_ACTIONS) return layout;
  return { ...layout, quickActions: [...layout.quickActions, toolId] };
}

export function withoutQuickAction(layout: HomeLayout, toolId: string): HomeLayout {
  return { ...layout, quickActions: layout.quickActions.filter((id) => id !== toolId) };
}

export function shiftQuickAction(layout: HomeLayout, toolId: string, delta: number): HomeLayout {
  const index = layout.quickActions.indexOf(toolId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= layout.quickActions.length) return layout;
  const next = [...layout.quickActions];
  [next[index], next[target]] = [next[target], next[index]];
  return { ...layout, quickActions: next };
}

export function moveQuickAction(layout: HomeLayout, toolId: string, index: number): HomeLayout {
  const from = layout.quickActions.indexOf(toolId);
  if (from < 0) return layout;
  const rest = layout.quickActions.filter((id) => id !== toolId);
  const target = Math.max(0, Math.min(rest.length, index));
  if (target === from) return layout;
  return { ...layout, quickActions: [...rest.slice(0, target), toolId, ...rest.slice(target)] };
}

export function dropIndex(midpoints: number[], pointer: number): number {
  const after = midpoints.findIndex((middle) => pointer < middle);
  return after < 0 ? midpoints.length : after;
}

export function bySize<T>(size: HomeSize, small: T, medium: T, large: T): T {
  return size === "small" ? small : size === "large" ? large : medium;
}
