import { useEffect } from "react";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";

type DropHandler = (paths: string[]) => void;
type DropPositionHandler = (paths: string[], position: { x: number; y: number }) => boolean;

export function useDropHandler(handler: DropHandler | null) {
  useEffect(() => {
    if (!handler) return;
    useDropTargetStore.getState().pushHandler(handler);
    return () => useDropTargetStore.getState().removeHandler(handler);
  }, [handler]);
}

export function useDropPositionHandler(handler: DropPositionHandler | null) {
  useEffect(() => {
    if (!handler) return;
    useDropTargetStore.getState().addPositionHandler(handler);
    return () => useDropTargetStore.getState().removePositionHandler(handler);
  }, [handler]);
}
