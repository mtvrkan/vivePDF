import { create } from "zustand";

export type Rotation = 0 | 90 | 180 | 270;
export type SessionPage = { id: string; path: string; page: number; rotation: Rotation };

export function appendScan(pages: SessionPage[], path: string, count: number, makeId: () => string = () => crypto.randomUUID()): SessionPage[] {
  const added = Array.from({ length: count }, (_, page) => ({ id: makeId(), path, page, rotation: 0 as Rotation }));
  return [...pages, ...added];
}

export function movePage(pages: SessionPage[], id: string, delta: number): SessionPage[] {
  const from = pages.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= pages.length) return pages;
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function rotatePage(pages: SessionPage[], id: string): SessionPage[] {
  return pages.map((item) => (item.id === id ? { ...item, rotation: (((item.rotation + 90) % 360) as Rotation) } : item));
}

export function removePage(pages: SessionPage[], id: string): SessionPage[] {
  return pages.filter((item) => item.id !== id);
}

export function sessionParts(pages: SessionPage[]): string[] {
  return [...new Set(pages.map((item) => item.path))];
}

export function orphanedParts(before: SessionPage[], after: SessionPage[]): string[] {
  const kept = new Set(sessionParts(after));
  return sessionParts(before).filter((path) => !kept.has(path));
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function autoScanName(prefix: string, date: Date): string {
  const day = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  const time = `${twoDigits(date.getHours())}-${twoDigits(date.getMinutes())}-${twoDigits(date.getSeconds())}`;
  return `${prefix} ${day} ${time}.pdf`;
}

type ScanSessionState = {
  pages: SessionPage[];
  setPages: (pages: SessionPage[]) => void;
};

export const useScanSessionStore = create<ScanSessionState>((set) => ({
  pages: [],
  setPages: (pages) => set({ pages }),
}));
