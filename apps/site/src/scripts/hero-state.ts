export type Point = { x: number; y: number; s: number };

export type HeroState = {
  still: boolean;
  started: boolean;
  heroP: number;
  mark: Point;
  logo: Point;
  bg: HTMLCanvasElement | null;
  onBg: (() => void) | null;
  onTheme: ((theme: string) => void) | null;
  intro: { progress(value?: number): number } | null;
  timer: number;
  fallback: () => void;
};

export const vp: HeroState = {
  still: false,
  started: false,
  heroP: 0,
  mark: { x: 0, y: 0, s: 0 },
  logo: { x: 0, y: 0, s: 0 },
  bg: null,
  onBg: null,
  onTheme: null,
  intro: null,
  timer: 0,
  fallback: () => {},
};
