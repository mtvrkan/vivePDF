const PATHS = {
  ink: "M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  inkHighlighter: "m9 11-6 6v3h9l3-3m7-5-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  highlight: "M5 16 9.5 4h1L15 16M7 12h6M3 20h18",
  underline: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16",
  strikeout: "M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16",
  textComment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  square: "M5 5h14v14H5z",
  circle: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
  lineArrow: "M5 19 19 5M9 5h10v10",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  remove: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  close: "M18 6 6 18M6 6l12 12",
} as const;

export type AnnotateIconName = keyof typeof PATHS;

export function AnnotateIcon({ name }: { name: AnnotateIconName }) {
  return (
    <svg class="vp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
