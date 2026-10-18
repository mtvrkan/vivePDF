import { create } from "zustand";

type DropHandler = (paths: string[]) => void;
type DropPositionHandler = (paths: string[], position: { x: number; y: number }) => boolean;

type DropTargetState = {
  handler: DropHandler | null;
  layered: DropHandler[];
  positionHandlers: DropPositionHandler[];
  dragging: boolean;
  setHandler: (handler: DropHandler | null) => void;
  pushHandler: (handler: DropHandler) => void;
  removeHandler: (handler: DropHandler) => void;
  addPositionHandler: (handler: DropPositionHandler) => void;
  removePositionHandler: (handler: DropPositionHandler) => void;
  claimPositionDrop: (paths: string[], position: { x: number; y: number }) => boolean;
  setDragging: (dragging: boolean) => void;
};

export const useDropTargetStore = create<DropTargetState>((set, get) => ({
  handler: null,
  layered: [],
  positionHandlers: [],
  dragging: false,
  setHandler: (handler) => set({ handler, layered: handler ? [handler] : [] }),
  pushHandler: (handler) => {
    const layered = [...get().layered.filter((entry) => entry !== handler), handler];
    set({ layered, handler });
  },
  removeHandler: (handler) => {
    const layered = get().layered.filter((entry) => entry !== handler);
    set({ layered, handler: get().handler === handler ? (layered.at(-1) ?? null) : get().handler });
  },
  addPositionHandler: (handler) => set({ positionHandlers: [...get().positionHandlers.filter((entry) => entry !== handler), handler] }),
  removePositionHandler: (handler) => set({ positionHandlers: get().positionHandlers.filter((entry) => entry !== handler) }),
  claimPositionDrop: (paths, position) => get().positionHandlers.some((handler) => handler(paths, position)),
  setDragging: (dragging) => set({ dragging }),
}));
