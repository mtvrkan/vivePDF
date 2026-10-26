import { create } from "zustand";

export type EquationKind = "inline" | "block";

export type EquationRequest = { kind: EquationKind; position: number | null; latex: string };

type EquationEditingState = {
  request: EquationRequest | null;
  open: (kind: EquationKind) => void;
  edit: (kind: EquationKind, position: number, latex: string) => void;
  close: () => void;
};

export const useEquationEditing = create<EquationEditingState>((set) => ({
  request: null,
  open: (kind) => set({ request: { kind, position: null, latex: "" } }),
  edit: (kind, position, latex) => set({ request: { kind, position, latex } }),
  close: () => set({ request: null }),
}));
