import { create } from "zustand";

export const GROUP_COLORS = ["blue", "green", "orange", "purple", "amber", "red", "teal", "cyan", "indigo", "pink", "lime", "brown", "gray"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const GROUP_TONES: Record<GroupColor, string> = {
  blue: "var(--tone-organize)",
  green: "var(--tone-improve)",
  orange: "var(--tone-toPdf)",
  purple: "var(--tone-fromPdf)",
  amber: "var(--tone-edit)",
  red: "var(--tone-security)",
  teal: "var(--group-teal)",
  cyan: "var(--group-cyan)",
  indigo: "var(--group-indigo)",
  pink: "var(--group-pink)",
  lime: "var(--group-lime)",
  brown: "var(--group-brown)",
  gray: "var(--group-gray)",
};

export type TabGroup = { id: string; name: string; color: GroupColor; collapsed: boolean };
export type SavedTabGroup = { name: string; color: GroupColor; collapsed: boolean; paths: string[] };

type TabGroupState = {
  groups: TabGroup[];
  memberOf: Record<string, string>;
  create: (documentIds: string[]) => string;
  join: (documentId: string, groupId: string) => void;
  leave: (documentId: string) => void;
  forget: (documentId: string) => void;
  rename: (groupId: string, name: string) => void;
  recolor: (groupId: string, color: GroupColor) => void;
  setCollapsed: (groupId: string, collapsed: boolean) => void;
  ungroup: (groupId: string) => void;
  restore: (groups: Array<{ name: string; color: GroupColor; collapsed: boolean; documentIds: string[] }>) => void;
};

let nextGroup = 0;

function groupId(): string {
  nextGroup += 1;
  return `group-${Date.now().toString(36)}-${nextGroup}`;
}

export function nextColor(groups: TabGroup[]): GroupColor {
  const used = new Set(groups.map((group) => group.color));
  return GROUP_COLORS.find((color) => !used.has(color)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
}

function withoutEmpty(groups: TabGroup[], memberOf: Record<string, string>): TabGroup[] {
  const live = new Set(Object.values(memberOf));
  return groups.filter((group) => live.has(group.id));
}

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === "string" && (GROUP_COLORS as readonly string[]).includes(value);
}

export const useTabGroupStore = create<TabGroupState>((set, get) => ({
  groups: [],
  memberOf: {},
  create: (documentIds) => {
    const id = groupId();
    set((state) => {
      const memberOf = { ...state.memberOf };
      for (const documentId of documentIds) memberOf[documentId] = id;
      const groups = withoutEmpty([...state.groups, { id, name: "", color: nextColor(state.groups), collapsed: false }], memberOf);
      return { groups, memberOf };
    });
    return id;
  },
  join: (documentId, target) =>
    set((state) => {
      if (!state.groups.some((group) => group.id === target)) return state;
      const memberOf = { ...state.memberOf, [documentId]: target };
      return { memberOf, groups: withoutEmpty(state.groups, memberOf) };
    }),
  leave: (documentId) =>
    set((state) => {
      if (!state.memberOf[documentId]) return state;
      const memberOf = { ...state.memberOf };
      delete memberOf[documentId];
      return { memberOf, groups: withoutEmpty(state.groups, memberOf) };
    }),
  forget: (documentId) => get().leave(documentId),
  rename: (target, name) =>
    set((state) => ({ groups: state.groups.map((group) => (group.id === target ? { ...group, name: name.trim().slice(0, 40) } : group)) })),
  recolor: (target, color) => set((state) => ({ groups: state.groups.map((group) => (group.id === target ? { ...group, color } : group)) })),
  setCollapsed: (target, collapsed) =>
    set((state) => ({ groups: state.groups.map((group) => (group.id === target ? { ...group, collapsed } : group)) })),
  ungroup: (target) =>
    set((state) => {
      const memberOf = Object.fromEntries(Object.entries(state.memberOf).filter(([, owner]) => owner !== target));
      return { memberOf, groups: state.groups.filter((group) => group.id !== target) };
    }),
  restore: (saved) =>
    set(() => {
      const groups: TabGroup[] = [];
      const memberOf: Record<string, string> = {};
      for (const entry of saved) {
        if (entry.documentIds.length === 0) continue;
        const id = groupId();
        groups.push({ id, name: entry.name, color: entry.color, collapsed: entry.collapsed });
        for (const documentId of entry.documentIds) memberOf[documentId] = id;
      }
      return { groups, memberOf };
    }),
}));

export function groupedOrder(order: string[], memberOf: Record<string, string>): string[] {
  const placed = new Set<string>();
  const result: string[] = [];
  for (const id of order) {
    if (placed.has(id)) continue;
    const owner = memberOf[id];
    const run = owner ? order.filter((entry) => memberOf[entry] === owner) : [id];
    for (const entry of run) {
      placed.add(entry);
      result.push(entry);
    }
  }
  return result;
}

export function groupAfterMove(order: string[], movedId: string, memberOf: Record<string, string>): string | null {
  const index = order.indexOf(movedId);
  if (index < 0) return memberOf[movedId] ?? null;
  const left = index > 0 ? memberOf[order[index - 1]] : undefined;
  const right = index < order.length - 1 ? memberOf[order[index + 1]] : undefined;
  if (left && left === right) return left;
  const own = memberOf[movedId];
  if (own && (left === own || right === own)) return own;
  return null;
}

export function savedGroups(order: string[], pathOf: (id: string) => string | undefined): SavedTabGroup[] {
  const { groups, memberOf } = useTabGroupStore.getState();
  return groups
    .map((group) => ({
      name: group.name,
      color: group.color,
      collapsed: group.collapsed,
      paths: order
        .filter((id) => memberOf[id] === group.id)
        .map(pathOf)
        .filter((path): path is string => !!path),
    }))
    .filter((group) => group.paths.length > 0);
}
