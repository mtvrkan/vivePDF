import { cvId, CV_LIMITS, type CvProfile } from "./cvModel";
import { useCvStore } from "./cvStore";

export type ListKey = keyof typeof CV_LIMITS;
type Identified = { id: string };
type ItemOf<K extends ListKey> = CvProfile[K][number];

let focusTarget: string | null = null;

export function claimFocus(id: string): boolean {
  if (focusTarget !== id) return false;
  focusTarget = null;
  return true;
}

function itemsOf(profile: CvProfile, key: ListKey): Identified[] {
  return profile[key] as Identified[];
}

function update(change: (profile: CvProfile) => CvProfile, merge?: string) {
  useCvStore.getState().updateProfile(change, merge);
}

export function setProfileField<K extends keyof CvProfile>(key: K, value: CvProfile[K], merge = true) {
  update((profile) => (profile[key] === value ? profile : { ...profile, [key]: value }), merge ? `field:${String(key)}` : undefined);
}

export function patchItem<K extends ListKey>(key: K, id: string, patch: Partial<ItemOf<K>>, merge = true) {
  const fields = Object.keys(patch).sort().join(",");
  update((profile) => ({ ...profile, [key]: itemsOf(profile, key).map((item) => (item.id === id ? { ...item, ...patch } : item)) }), merge ? `${key}:${id}:${fields}` : undefined);
}

export function canAdd(profile: CvProfile, key: ListKey, count = 1): boolean {
  return itemsOf(profile, key).length + count <= CV_LIMITS[key];
}

export function addItems<K extends ListKey>(key: K, items: ItemOf<K>[], after?: string, focus = true): string | null {
  const profile = useCvStore.getState().profile;
  const room = CV_LIMITS[key] - itemsOf(profile, key).length;
  const added = items.slice(0, Math.max(0, room));
  if (!added.length) return null;
  update((current) => {
    const list = [...itemsOf(current, key)];
    const index = after ? list.findIndex((item) => item.id === after) : -1;
    list.splice(index < 0 ? list.length : index + 1, 0, ...(added as Identified[]));
    return { ...current, [key]: list };
  });
  const first = (added[0] as Identified).id;
  if (focus) focusTarget = first;
  return first;
}

export function removeItem(key: ListKey, id: string): { item: Identified; index: number } | null {
  const list = itemsOf(useCvStore.getState().profile, key);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const item = list[index];
  update((profile) => ({ ...profile, [key]: itemsOf(profile, key).filter((entry) => entry.id !== id) }));
  return { item, index };
}

export function restoreItem(key: ListKey, item: Identified, index: number) {
  update((profile) => {
    const list = itemsOf(profile, key);
    if (list.some((entry) => entry.id === item.id) || list.length >= CV_LIMITS[key]) return profile;
    const next = [...list];
    next.splice(Math.min(index, next.length), 0, item);
    return { ...profile, [key]: next };
  });
}

export function duplicateItem(key: ListKey, id: string): string | null {
  const source = itemsOf(useCvStore.getState().profile, key).find((item) => item.id === id);
  if (!source) return null;
  return addItems(key, [{ ...source, id: cvId() }] as ItemOf<typeof key>[], id);
}

export function moveItem(key: ListKey, from: number, to: number) {
  update((profile) => {
    const list = [...itemsOf(profile, key)];
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return profile;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    return { ...profile, [key]: list };
  });
}
