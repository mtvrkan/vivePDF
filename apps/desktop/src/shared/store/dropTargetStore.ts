import { create } from "zustand";

type DropHandler = (paths: string[]) => void;
type DropPositionHandler = (paths: string[], position: { x: number; y: number }) => boolean;

type DropTargetState = {
  handler: DropHandler | null;
  positionHandlers: DropPositionHandler[];
  dragging: boolean;
  setHandler: (handler: DropHandler | null) => void;
  addPositionHandler: (handler: DropPositionHandler) => void;
  removePositionHandler: (handler: DropPositionHandler) => void;
  claimPositionDrop: (paths: string[], position: { x: number; y: number }) => boolean;
  setDragging: (dragging: boolean) => void;
};

export const useDropTargetStore = create<DropTargetState>((set, get) => ({
  handler: null,
  positionHandlers: [],
  dragging: false,
  setHandler: (handler) => set({ handler }),
  addPositionHandler: (handler) => set({ positionHandlers: [...get().positionHandlers.filter((entry) => entry !== handler), handler] }),
  removePositionHandler: (handler) => set({ positionHandlers: get().positionHandlers.filter((entry) => entry !== handler) }),
  claimPositionDrop: (paths, position) => get().positionHandlers.some((handler) => handler(paths, position)),
  setDragging: (dragging) => set({ dragging }),
}));
