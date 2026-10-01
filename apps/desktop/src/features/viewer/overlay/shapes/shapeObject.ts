import type { ShapeParams } from "./catalog";
import type { ShapeStyle } from "./render";

export type ShapeSource = { id: string; params: ShapeParams; style: ShapeStyle; svg: string; width: number; height: number };
