import { useEffect } from "react";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";

type DropHandler = (paths: string[]) => void;
type DropPositionHandler = (paths: string[], position: { x: number; y: number }) => boolean;

export function useDropHandler(handler: DropHandler | null) {
  useEffect(() => {
    if (!handler) return;
    const store = useDropTargetStore.getState();
    const previous = store.handler;
    store.setHandler(handler);
    return () => useDropTargetStore.getState().setHandler(previous);
  }, [handler]);
}

export function useDropPositionHandler(handler: DropPositionHandler | null) {
  useEffect(() => {
    if (!handler) return;
    useDropTargetStore.getState().addPositionHandler(handler);
    return () => useDropTargetStore.getState().removePositionHandler(handler);
  }, [handler]);
}
