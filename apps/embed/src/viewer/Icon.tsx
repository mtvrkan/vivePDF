const PATHS = {
  panel: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18",
  up: "m18 15-6-6-6 6",
  down: "m6 9 6 6 6-6",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-3.5-3.5",
  rotate: "M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  fitWidth: "m18 8 4 4-4 4M2 12h20M6 8l-4 4 4 4",
  fitPage: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
  single: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
  double: "M3 4h7v16H3zM14 4h7v16h-7z",
  check: "M20 6 9 17l-5-5",
  close: "M18 6 6 18M6 6l12 12",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="vp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
