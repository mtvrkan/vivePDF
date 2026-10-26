import { useRef } from "react";
import { useStudioStore } from "./studioStore";

export function useHeldWhileInteracting<T>(value: T): T {
  const interacting = useStudioStore((state) => state.interacting);
  const held = useRef(value);
  if (!interacting) held.current = value;
  return held.current;
}
