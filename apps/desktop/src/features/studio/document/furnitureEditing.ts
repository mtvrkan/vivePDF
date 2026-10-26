import { create } from "zustand";

export type FurniturePart = "header" | "footer";

type FurnitureEditingState = {
  editing: FurniturePart | null;
  request: { part: FurniturePart; nonce: number } | null;
  edit: (part: FurniturePart) => void;
  open: (part: FurniturePart) => void;
  stop: () => void;
};

export const useFurnitureEditing = create<FurnitureEditingState>((set, get) => ({
  editing: null,
  request: null,
  edit: (editing) => set({ editing }),
  open: (part) => set({ editing: part, request: { part, nonce: (get().request?.nonce ?? 0) + 1 } }),
  stop: () => set({ editing: null }),
}));
