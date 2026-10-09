import { STUDIO_FINISHES, STUDIO_FOILS, type StudioElement, type StudioFinish, type StudioFinishType, type StudioFoil } from "@/types/studio";
import { linearGradientLine } from "./shapes";

export const FINISH_DEPTH = { min: 0.2, max: 3 } as const;
export const FINISH_SOFTNESS = { min: 0, max: 3 } as const;
export const DEFAULT_LIGHT_ANGLE = 315;

export type FinishRegion = "light" | "away" | "outerLight" | "outerAway";

export type FinishLayer = { region: FinishRegion; color: string; opacity: number; blur: number };

export type FinishStop = { offset: number; color: string; opacity: number };

export type FinishTexture = { x1: number; y1: number; x2: number; y2: number; stops: FinishStop[]; replace: boolean };

export type FinishRecipe = { dx: number; dy: number; ink: boolean; layers: FinishLayer[]; texture: FinishTexture | null };

const DEFAULTS: Record<StudioFinishType, Omit<StudioFinish, "type" | "foil" | "angle">> = {
  emboss: { depth: 1.2, softness: 0.8, blind: true },
  deboss: { depth: 1, softness: 0.7, blind: true },
  letterpress: { depth: 0.8, softness: 0.5, blind: false },
  foil: { depth: 0.4, softness: 0.4, blind: false },
  spotUv: { depth: 0.4, softness: 0.3, blind: false },
};

const FOIL_STOPS: Record<StudioFoil, string[]> = {
  gold: ["#8a6a1f", "#f7e08a", "#b8892b", "#fff3c4", "#a87b22", "#e9c766"],
  silver: ["#8d939b", "#f4f6f8", "#a7adb5", "#ffffff", "#9aa1a9", "#d9dde2"],
  copper: ["#7a3f1d", "#f0b58a", "#a85a2e", "#ffd9bd", "#8f4a24", "#d98b5b"],
  roseGold: ["#9a5f5a", "#f6cfc6", "#b77b72", "#ffe9e3", "#a5675f", "#e2a99f"],
  holographic: ["#b18cff", "#6fe3ff", "#fff07a", "#ff8fd8", "#7ff2b5", "#b18cff"],
};

const FOIL_OFFSETS = [0, 0.25, 0.45, 0.6, 0.8, 1];
const GLOSS_STOPS: FinishStop[] = [
  { offset: 0, color: "#ffffff", opacity: 0.04 },
  { offset: 0.3, color: "#ffffff", opacity: 0.6 },
  { offset: 0.42, color: "#ffffff", opacity: 0.12 },
  { offset: 0.56, color: "#000000", opacity: 0.12 },
  { offset: 0.76, color: "#ffffff", opacity: 0.38 },
  { offset: 1, color: "#ffffff", opacity: 0.06 },
];

export function defaultFinish(type: StudioFinishType, foil: StudioFoil = "gold"): StudioFinish {
  return { type, ...DEFAULTS[type], angle: DEFAULT_LIGHT_ANGLE, foil };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeFinish(value: unknown): StudioFinish | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = STUDIO_FINISHES.find((item) => item === raw.type);
  if (!type) return null;
  const base = DEFAULTS[type];
  const angle = finiteOr(raw.angle, DEFAULT_LIGHT_ANGLE) % 360;
  return {
    type,
    depth: clamp(finiteOr(raw.depth, base.depth), FINISH_DEPTH.min, FINISH_DEPTH.max),
    softness: clamp(finiteOr(raw.softness, base.softness), FINISH_SOFTNESS.min, FINISH_SOFTNESS.max),
    angle: angle < 0 ? angle + 360 : angle,
    blind: typeof raw.blind === "boolean" ? raw.blind : base.blind,
    foil: STUDIO_FOILS.find((item) => item === raw.foil) ?? "gold",
  };
}

export function hasInkChoice(type: StudioFinishType): boolean {
  return type === "emboss" || type === "deboss";
}

function localAngle(angle: number, element: Pick<StudioElement, "rotation" | "flipX" | "flipY">): number {
  let turned = angle - element.rotation;
  if (element.flipX) turned = -turned;
  if (element.flipY) turned = 180 - turned;
  return ((turned % 360) + 360) % 360;
}

function layersOf(finish: StudioFinish): FinishLayer[] {
  const blur = finish.softness;
  switch (finish.type) {
    case "emboss":
      return [
        { region: "outerAway", color: "#000000", opacity: 0.16, blur: blur * 1.5 },
        { region: "away", color: "#000000", opacity: 0.38, blur },
        { region: "light", color: "#ffffff", opacity: 0.85, blur },
      ];
    case "deboss":
      return [
        { region: "outerLight", color: "#ffffff", opacity: 0.35, blur: blur * 1.5 },
        { region: "light", color: "#000000", opacity: 0.4, blur },
        { region: "away", color: "#ffffff", opacity: 0.75, blur },
      ];
    case "letterpress":
      return [
        { region: "light", color: "#000000", opacity: 0.5, blur },
        { region: "away", color: "#ffffff", opacity: 0.6, blur },
      ];
    case "foil":
      return [
        { region: "away", color: "#000000", opacity: 0.25, blur },
        { region: "light", color: "#ffffff", opacity: 0.5, blur },
      ];
    case "spotUv":
      return [
        { region: "away", color: "#000000", opacity: 0.22, blur },
        { region: "light", color: "#ffffff", opacity: 0.55, blur },
      ];
  }
}

function textureOf(finish: StudioFinish, angle: number, width: number, height: number): FinishTexture | null {
  if (finish.type !== "foil" && finish.type !== "spotUv") return null;
  const line = linearGradientLine((angle + 45) % 360, width, height);
  if (finish.type === "spotUv") return { ...line, stops: GLOSS_STOPS, replace: false };
  return { ...line, stops: FOIL_STOPS[finish.foil].map((color, index) => ({ offset: FOIL_OFFSETS[index], color, opacity: 1 })), replace: true };
}

export function finishRecipe(finish: StudioFinish, element: Pick<StudioElement, "rotation" | "flipX" | "flipY" | "width" | "height">): FinishRecipe {
  const angle = localAngle(finish.angle, element);
  const radians = (angle * Math.PI) / 180;
  const texture = textureOf(finish, angle, element.width, element.height);
  return {
    dx: -Math.sin(radians) * finish.depth,
    dy: Math.cos(radians) * finish.depth,
    ink: hasInkChoice(finish.type) ? !finish.blind : !texture?.replace,
    layers: layersOf(finish),
    texture,
  };
}

export function finishReach(recipe: FinishRecipe): number {
  const blur = Math.max(0, ...recipe.layers.map((layer) => layer.blur));
  return Math.hypot(recipe.dx, recipe.dy) + 3 * blur + 2;
}
