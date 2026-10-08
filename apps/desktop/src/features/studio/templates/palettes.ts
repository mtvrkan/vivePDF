export type Palette = { ink: string; paper: string; accent: string; accent2: string; muted: string; soft: string };

export const PALETTES = {
  midnightGold: { ink: "#0f172a", paper: "#fbf8f1", accent: "#16233f", accent2: "#b8893b", muted: "#5b6478", soft: "#efe7d6" },
  ivoryNavy: { ink: "#14213d", paper: "#fffdf7", accent: "#1d3461", accent2: "#c9a227", muted: "#5c6784", soft: "#eef1f7" },
  emeraldBrass: { ink: "#0b2b26", paper: "#f7f5ee", accent: "#0f4c3a", accent2: "#b08d57", muted: "#4f6b63", soft: "#e4ede7" },
  blushRose: { ink: "#3b1f2b", paper: "#fff8f6", accent: "#b5576d", accent2: "#c9a27e", muted: "#7d5d66", soft: "#f8e4e2" },
  sageLinen: { ink: "#23302a", paper: "#f6f4ec", accent: "#6b8f71", accent2: "#c2a878", muted: "#5d6b62", soft: "#e3eadf" },
  terracotta: { ink: "#2e1d16", paper: "#fbf5ee", accent: "#b85c38", accent2: "#e0a458", muted: "#76594b", soft: "#f3e1d3" },
  oceanMist: { ink: "#0e2a3b", paper: "#f5f9fb", accent: "#1f6f8b", accent2: "#99c1b9", muted: "#4f6b7a", soft: "#dfeef2" },
  plumChampagne: { ink: "#2a1630", paper: "#fbf7f4", accent: "#5e2a5f", accent2: "#d4b483", muted: "#6c5970", soft: "#efe4ec" },
  charcoalCoral: { ink: "#1f2328", paper: "#fafafa", accent: "#2d3436", accent2: "#ff6b57", muted: "#5f666d", soft: "#eceef0" },
  forestCream: { ink: "#1b2a1f", paper: "#fbf8ef", accent: "#2f4f3a", accent2: "#d9a441", muted: "#5a6a5e", soft: "#eae6d3" },
  slateCitrus: { ink: "#1e293b", paper: "#f8fafc", accent: "#334155", accent2: "#eab308", muted: "#5b6577", soft: "#e2e8f0" },
  burgundyGold: { ink: "#2b0f17", paper: "#fdf8f3", accent: "#6d1a2d", accent2: "#c59d5f", muted: "#76545c", soft: "#f2e3dd" },
  sandstone: { ink: "#2f2a24", paper: "#faf6ef", accent: "#8c6d4f", accent2: "#3f5e5a", muted: "#6e655b", soft: "#ede3d4" },
  nordicFrost: { ink: "#17212b", paper: "#f7f9fa", accent: "#3d5a73", accent2: "#a3b9c9", muted: "#5a6875", soft: "#e4ebf0" },
  mochaCream: { ink: "#2b1e17", paper: "#fbf7f2", accent: "#6f4e37", accent2: "#d6a77a", muted: "#6f5d51", soft: "#efe2d4" },
  cobaltSun: { ink: "#0d1b3e", paper: "#fbfaf6", accent: "#1d4ed8", accent2: "#f5b700", muted: "#4d5a78", soft: "#e3e9fb" },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

export function paletteList(palette: Palette): string[] {
  return [...new Set([palette.accent, palette.accent2, palette.ink, palette.paper, palette.muted, palette.soft])];
}
