import type { StudioElement } from "@/types/studio";
import { art, box, FONTS, foil, gradient, linear, rule, solid } from "../templates/kit";
import type { CvLayoutId } from "./cvModel";
import { contactGrid, contactLine, mix, textLine, type CvContext, type CvPalette, type CvSpec, type Frame } from "./cvLayout";

const WHITE = "#ffffff";
const BLACK = "#000000";
const GOLD = "#b8893b";

function lightPalette(accent: string, overrides: Partial<CvPalette> = {}): CvPalette {
  return {
    page: WHITE,
    text: "#111827",
    muted: "#4b5563",
    accent,
    soft: mix(accent, WHITE, 0.82),
    line: "#e5e7eb",
    sideFill: null,
    sideText: "#111827",
    sideMuted: "#4b5563",
    sideAccent: accent,
    sideSoft: mix(accent, WHITE, 0.82),
    ...overrides,
  };
}

function single(context: CvContext, margin: number, decor: StudioElement[] = []): Frame {
  return { decor, main: { x: margin, width: context.width - margin * 2, top: margin, bottom: context.height - margin }, side: null };
}

type HeaderOptions = {
  nameSize: number;
  nameColor: string;
  headlineColor: string;
  contactColor: string;
  upper?: boolean;
  spacing?: number;
  headlineItalic?: boolean;
  contacts?: boolean;
  iconColumns?: number;
  iconColor?: string;
};

function headerBlock(context: CvContext, x: number, y: number, width: number, align: "left" | "center", options: HeaderOptions): { elements: StudioElement[]; bottom: number } {
  const elements: StudioElement[] = [];
  const name = textLine(context, x, y, width, context.profile.name, { font: context.fonts.heading, size: context.size(options.nameSize), bold: true, color: options.nameColor, align, upper: options.upper, spacing: options.spacing, lineHeight: 1.1 });
  if (name.element) elements.push(name.element);
  const headline = textLine(context, x, name.bottom + 4, width, context.profile.headline, {
    font: context.fonts.heading,
    size: context.size(11),
    color: options.headlineColor,
    align,
    upper: !options.headlineItalic,
    italic: options.headlineItalic,
    spacing: options.headlineItalic ? 0 : 1.8,
  });
  if (headline.element) elements.push(headline.element);
  let bottom = headline.bottom;
  if (options.contacts !== false && options.iconColumns) {
    const grid = contactGrid(context, x, bottom + 12, width, options.iconColumns, options.contactColor, options.iconColor ?? options.headlineColor);
    elements.push(...grid.elements);
    bottom = grid.bottom;
  } else if (options.contacts !== false) {
    const contacts = textLine(context, x, bottom + 8, width, contactLine(context, align === "center" ? "   ·   " : "   •   "), { size: context.size(8.6), color: options.contactColor, align, lineHeight: 1.5 });
    if (contacts.element) elements.push(contacts.element);
    bottom = contacts.bottom;
  }
  return { elements, bottom };
}

function sidebarFrame(context: CvContext, side: "left" | "right", sideWidth: number, fill: StudioElement[], margin: number): Frame {
  const inner = 22;
  const sideX = side === "left" ? inner : context.width - sideWidth + inner;
  const mainX = side === "left" ? sideWidth + 30 : margin;
  const mainWidth = context.width - sideWidth - 30 - margin;
  return {
    decor: fill,
    main: { x: mainX, width: mainWidth, top: margin, bottom: context.height - margin },
    side: { x: sideX, width: sideWidth - inner * 2, top: margin, bottom: context.height - margin },
  };
}

const modern: CvSpec = {
  id: "modern",
  accent: "#38bdf8",
  fonts: { heading: FONTS.montserrat, body: FONTS.inter },
  palette: (accent) =>
    lightPalette(mix(accent, BLACK, 0.4), {
      text: "#0f172a",
      muted: "#475569",
      soft: mix(accent, WHITE, 0.75),
      sideFill: "#1e293b",
      sideText: "#f1f5f9",
      sideMuted: "#cbd5e1",
      sideAccent: accent,
      sideSoft: "#334155",
    }),
  frame: (context) => sidebarFrame(context, "left", 196, [box("rect", 0, 0, 196, context.height, gradient(180, ["#1e293b", "#0f172a"])), box("rect", 0, 0, 196, 5, solid(context.palette.sideAccent))], 40),
  header: (context, frame) => {
    const side = frame.side;
    const elements: StudioElement[] = [];
    let sideTop = side?.top ?? 0;
    if (side && context.hasPhoto()) {
      const size = 118;
      elements.push(...context.photo(side.x + (side.width - size) / 2, side.top, size, "#334155", context.palette.sideAccent));
      sideTop = side.top + size + 26;
    }
    const header = headerBlock(context, frame.main.x, frame.main.top, frame.main.width, "left", { nameSize: 30, nameColor: "#0f172a", headlineColor: context.palette.accent, contactColor: "#64748b", contacts: false });
    elements.push(...header.elements);
    if (context.profile.name.trim() || context.profile.headline.trim()) elements.push(box("rect", frame.main.x, header.bottom + 13, 48, 3.5, solid(context.palette.sideAccent), { radius: 1.75 }));
    return { elements, mainTop: header.bottom + 32, sideTop };
  },
  side: ["contact", "skills", "languages", "interests"],
  title: "rule",
  entry: "timeline",
  photo: true,
  contactIcons: true,
  levelBar: "thin",
  photoRing: true,
  skillStyle: "bars",
};

const classic: CvSpec = {
  id: "classic",
  accent: "#1f3a5f",
  fonts: { heading: FONTS.lora, body: FONTS.sourceSerif },
  palette: (accent) => lightPalette(accent, { text: "#1c1917", muted: "#44403c", soft: "#d6d3d1" }),
  frame: (context) => single(context, 54),
  header: (context, frame) => {
    const { main } = frame;
    const header = headerBlock(context, main.x, main.top, main.width, "center", { nameSize: 27, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, upper: true, spacing: 2.5, headlineItalic: true });
    const elements = [...header.elements, rule(main.x, header.bottom + 12, main.width, context.palette.text, 1.4), rule(main.x, header.bottom + 15.5, main.width, context.palette.text, 0.5)];
    return { elements, mainTop: header.bottom + 32, sideTop: main.top };
  },
  side: [],
  title: "rule",
  entry: "stacked",
  photo: false,
  skillStyle: "dots",
};

const corporate: CvSpec = {
  id: "corporate",
  accent: "#0f766e",
  fonts: { heading: FONTS.poppins, body: FONTS.nunito },
  palette: (accent) => lightPalette(accent, { text: "#0f172a", muted: "#475569", sideFill: mix(accent, WHITE, 0.92), sideSoft: mix(accent, WHITE, 0.7) }),
  frame: (context, pageIndex) => {
    const band = pageIndex === 0 ? 136 : 0;
    const sideWidth = 186;
    const decor: StudioElement[] = [box("rect", context.width - sideWidth, band, sideWidth, context.height - band, solid(context.palette.sideFill ?? WHITE))];
    if (band) {
      decor.unshift(
        box("rect", 0, 0, context.width, band, linear(90, context.palette.accent, mix(context.palette.accent, BLACK, 0.4))),
        art("diagonalHatch", { primary: WHITE, secondary: WHITE }, 0, 0, context.width, band, { opacity: 0.1 }),
        box("rect", 0, band - 3, context.width, 3, solid(mix(context.palette.accent, WHITE, 0.55))),
      );
    } else decor.unshift(box("rect", 0, 0, context.width, 6, solid(context.palette.accent)));
    return {
      decor,
      main: { x: 40, width: context.width - sideWidth - 70, top: band + 30, bottom: context.height - 40 },
      side: { x: context.width - sideWidth + 20, width: sideWidth - 40, top: band + 30, bottom: context.height - 40 },
    };
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    let x = 40;
    if (context.hasPhoto()) {
      const size = 92;
      elements.push(...context.photo(x, 22, size, mix(context.palette.accent, WHITE, 0.45), WHITE));
      x += size + 26;
    }
    const header = headerBlock(context, x, 36, context.width - x - 40, "left", { nameSize: 28, nameColor: WHITE, headlineColor: mix(context.palette.accent, WHITE, 0.78), contactColor: WHITE, contacts: false });
    elements.push(...header.elements);
    return { elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0 };
  },
  side: ["contact", "skills", "languages", "certificates", "interests"],
  title: "underline",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
  contactIcons: true,
  levelBar: "segmented",
  photoRing: true,
  skillStyle: "bars",
};

const minimal: CvSpec = {
  id: "minimal",
  accent: "#111827",
  fonts: { heading: FONTS.inter, body: FONTS.inter },
  palette: (accent) => lightPalette(accent, { text: "#111827", muted: "#6b7280", soft: "#e5e7eb" }),
  frame: (context) => single(context, 58),
  header: (context, frame) => {
    const { main } = frame;
    const elements: StudioElement[] = [];
    let width = main.width;
    if (context.hasPhoto()) {
      const size = 78;
      elements.push(...context.photo(main.x + main.width - size, main.top, size, "#f3f4f6"));
      width -= size + 24;
    }
    const header = headerBlock(context, main.x, main.top, width, "left", { nameSize: 32, nameColor: context.palette.text, headlineColor: context.palette.muted, contactColor: context.palette.muted, iconColumns: 2, iconColor: context.palette.accent });
    elements.push(...header.elements);
    const bottom = Math.max(header.bottom, context.hasPhoto() ? main.top + 78 : 0);
    return { elements, mainTop: bottom + 32, sideTop: main.top };
  },
  side: [],
  title: "plain",
  entry: "dateLeft",
  photo: true,
  levelBar: "thin",
  skillStyle: "dots",
};

const creative: CvSpec = {
  id: "creative",
  accent: "#e11d48",
  fonts: { heading: FONTS.raleway, body: FONTS.nunito },
  palette: (accent) =>
    lightPalette(accent, {
      text: "#1f2937",
      muted: "#4b5563",
      sideFill: accent,
      sideText: WHITE,
      sideMuted: mix(accent, WHITE, 0.8),
      sideAccent: WHITE,
      sideSoft: mix(accent, BLACK, 0.25),
    }),
  frame: (context, pageIndex) => {
    const sideWidth = 200;
    const fill = box("rect", context.width - sideWidth, 0, sideWidth, context.height, linear(160, context.palette.accent, mix(context.palette.accent, BLACK, 0.4)));
    const soft = mix(context.palette.accent, WHITE, 0.86);
    const decor = pageIndex === 0 ? [art("blob", { primary: soft, secondary: mix(context.palette.accent, WHITE, 0.92) }, -70, -80, 200, 200, { opacity: 0.9 })] : [];
    return sidebarFrame(context, "right", sideWidth, [...decor, fill], 40);
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    let sideTop = frame.side?.top ?? 0;
    if (frame.side && context.hasPhoto()) {
      const size = 120;
      const x = frame.side.x + (frame.side.width - size) / 2;
      elements.push(...context.photo(x, frame.side.top, size, mix(context.palette.accent, WHITE, 0.4), WHITE));
      sideTop = frame.side.top + size + 26;
    }
    const header = headerBlock(context, frame.main.x, frame.main.top + 14, frame.main.width, "left", { nameSize: 34, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, contacts: false });
    elements.push(...header.elements);
    return { elements, mainTop: header.bottom + 30, sideTop };
  },
  side: ["contact", "skills", "languages", "interests", "references"],
  title: "leftBar",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
  contactIcons: true,
  photoRing: true,
  skillStyle: "chips",
};

const timeline: CvSpec = {
  id: "timeline",
  accent: "#0d9488",
  fonts: { heading: FONTS.josefin, body: FONTS.nunito },
  palette: (accent) => lightPalette(mix(accent, BLACK, 0.2), { text: "#134e4a", muted: "#475569", soft: mix(accent, WHITE, 0.8) }),
  frame: (context, pageIndex) => single(context, 50, [box("rect", 0, 0, context.width, pageIndex === 0 ? 10 : 5, linear(90, context.palette.accent, mix(context.palette.accent, WHITE, 0.45)))]),
  header: (context, frame) => {
    const { main } = frame;
    const elements: StudioElement[] = [];
    let top = main.top;
    if (context.hasPhoto()) {
      const size = 96;
      elements.push(...context.photo(main.x + (main.width - size) / 2, top, size, context.palette.soft));
      top += size + 18;
    }
    const header = headerBlock(context, main.x, top, main.width, "center", { nameSize: 30, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted });
    elements.push(...header.elements);
    return { elements, mainTop: header.bottom + 28, sideTop: main.top };
  },
  side: [],
  title: "leftBar",
  entry: "timeline",
  photo: true,
  levelBar: "segmented",
  photoRing: true,
  skillStyle: "bars",
};

const compact: CvSpec = {
  id: "compact",
  accent: "#2563eb",
  fonts: { heading: FONTS.inter, body: FONTS.inter },
  palette: (accent) => lightPalette(accent),
  frame: (context) => {
    const margin = 36;
    const sideWidth = Math.round((context.width - margin * 2) * 0.34);
    const mainWidth = context.width - margin * 2 - sideWidth - 24;
    return {
      decor: [box("rect", 0, 0, context.width, 4, solid(context.palette.accent))],
      main: { x: margin, width: mainWidth, top: margin, bottom: context.height - margin },
      side: { x: margin + mainWidth + 24, width: sideWidth, top: margin, bottom: context.height - margin },
    };
  },
  header: (context, frame) => {
    const margin = frame.main.x;
    const width = context.width - margin * 2;
    const elements: StudioElement[] = [];
    let textWidth = width;
    if (context.hasPhoto()) {
      const size = 64;
      elements.push(...context.photo(margin + width - size, margin, size, context.palette.soft));
      textWidth -= size + 18;
    }
    const header = headerBlock(context, margin, margin, textWidth, "left", { nameSize: 25, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, iconColumns: 3, iconColor: context.palette.accent });
    elements.push(...header.elements);
    const bottom = Math.max(header.bottom, context.hasPhoto() ? margin + 64 : 0) + 12;
    elements.push(rule(margin, bottom, width, context.palette.line, 1));
    return { elements, mainTop: bottom + 16, sideTop: bottom + 16 };
  },
  side: ["skills", "languages", "certificates", "interests", "references"],
  title: "underline",
  entry: "stacked",
  photo: true,
  levelBar: "thin",
  skillStyle: "bars",
};

const elegant: CvSpec = {
  id: "elegant",
  accent: "#a16207",
  fonts: { heading: FONTS.cormorant, body: FONTS.garamond },
  palette: (accent) => lightPalette(accent, { page: "#fffdf8", text: "#292524", muted: "#57534e", soft: mix(accent, WHITE, 0.7) }),
  frame: (context) => {
    const line = mix(context.palette.accent, WHITE, 0.45);
    return single(context, 60, [
      box("rect", 18, 18, context.width - 36, context.height - 36, { type: "none" }, { stroke: { color: line, width: 0.9, dash: "solid" } }),
      box("rect", 23, 23, context.width - 46, context.height - 46, { type: "none" }, { stroke: { color: line, width: 0.4, dash: "solid" } }),
    ]);
  },
  header: (context, frame) => {
    const { main } = frame;
    const elements: StudioElement[] = [];
    let top = main.top;
    if (context.hasPhoto()) {
      const size = 88;
      elements.push(...context.photo(main.x + (main.width - size) / 2, top, size, context.palette.soft));
      top += size + 18;
    }
    const header = headerBlock(context, main.x, top, main.width, "center", { nameSize: 31, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, upper: true, spacing: 3, headlineItalic: true });
    elements.push(...header.elements, art("flourishDivider", { primary: context.palette.accent, secondary: context.palette.accent }, main.x + main.width / 2 - 80, header.bottom + 10, 160, 20));
    return { elements, mainTop: header.bottom + 44, sideTop: main.top };
  },
  side: [],
  title: "centered",
  entry: "dateLeft",
  photo: true,
  photoRing: true,
  skillStyle: "dots",
};

const tech: CvSpec = {
  id: "tech",
  accent: "#22c55e",
  fonts: { heading: FONTS.oswald, body: FONTS.inter },
  palette: (accent) => lightPalette(mix(accent, BLACK, 0.36), { text: "#0f172a", muted: "#475569", soft: mix(accent, WHITE, 0.78), sideFill: "#f1f5f9", sideSoft: mix(accent, WHITE, 0.72), sideAccent: mix(accent, BLACK, 0.3) }),
  frame: (context, pageIndex) => {
    const band = pageIndex === 0 ? 124 : 0;
    const sideWidth = 180;
    const decor: StudioElement[] = [box("rect", 0, band, sideWidth, context.height - band, solid("#f1f5f9"))];
    if (band) {
      const glow = mix(context.palette.accent, WHITE, 0.2);
      decor.unshift(
        box("rect", 0, 0, context.width, band, linear(90, "#0f172a", "#1e293b")),
        art("halftone", { primary: glow, secondary: glow }, context.width * 0.55, 0, context.width * 0.45, band, { opacity: 0.16 }),
        box("rect", 0, band - 4, context.width, 4, solid(glow)),
      );
    }
    return {
      decor,
      main: { x: sideWidth + 28, width: context.width - sideWidth - 64, top: band + 28, bottom: context.height - 36 },
      side: { x: 20, width: sideWidth - 40, top: band + 28, bottom: context.height - 36 },
    };
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    let x = 36;
    if (context.hasPhoto()) {
      const size = 82;
      elements.push(...context.photo(x, 21, size, "#1e293b", mix(context.palette.accent, WHITE, 0.2)));
      x += size + 24;
    }
    const header = headerBlock(context, x, 28, context.width - x - 36, "left", { nameSize: 30, nameColor: WHITE, headlineColor: mix(context.palette.accent, WHITE, 0.35), contactColor: "#cbd5e1", upper: true, spacing: 1 });
    elements.push(...header.elements);
    return { elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0 };
  },
  side: ["skills", "languages", "certificates", "interests"],
  title: "rule",
  sideTitle: "plain",
  entry: "timeline",
  photo: true,
  levelBar: "segmented",
  photoRing: true,
  skillStyle: "bars",
};

const ats: CvSpec = {
  id: "ats",
  accent: "#1f2937",
  fonts: { heading: FONTS.inter, body: FONTS.inter },
  palette: (accent) => lightPalette(accent, { text: "#111827", muted: "#374151", soft: "#d1d5db" }),
  frame: (context) => single(context, 50),
  header: (context, frame) => {
    const { main } = frame;
    const header = headerBlock(context, main.x, main.top, main.width, "left", { nameSize: 24, nameColor: context.palette.text, headlineColor: context.palette.text, contactColor: context.palette.muted, headlineItalic: true });
    return { elements: header.elements, mainTop: header.bottom + 20, sideTop: main.top };
  },
  side: [],
  title: "rule",
  entry: "stacked",
  photo: false,
  skillStyle: "text",
};

const executive: CvSpec = {
  id: "executive",
  accent: "#1d3461",
  fonts: { heading: FONTS.playfair, body: FONTS.sourceSerif },
  palette: (accent) =>
    lightPalette(accent, {
      text: "#111827",
      muted: "#4b5563",
      soft: mix(accent, WHITE, 0.8),
      sideFill: mix(accent, WHITE, 0.94),
      sideText: "#111827",
      sideMuted: "#4b5563",
      sideAccent: accent,
      sideSoft: mix(accent, WHITE, 0.76),
    }),
  frame: (context, pageIndex) => {
    const band = pageIndex === 0 ? 150 : 0;
    const sideWidth = 190;
    const decor: StudioElement[] = [box("rect", context.width - sideWidth, band, sideWidth, context.height - band, solid(context.palette.sideFill ?? WHITE))];
    if (band) decor.unshift(box("rect", 0, 0, context.width, band, gradient(120, [context.palette.accent, mix(context.palette.accent, BLACK, 0.38)])), box("rect", 0, band, context.width, 3, foil("gold", 0)));
    else decor.unshift(box("rect", 0, 0, context.width, 3, foil("gold", 0)));
    const top = band + (band ? 32 : 40);
    return {
      decor,
      main: { x: 44, width: context.width - sideWidth - 76, top, bottom: context.height - 44 },
      side: { x: context.width - sideWidth + 22, width: sideWidth - 44, top, bottom: context.height - 44 },
    };
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    let width = context.width - 88;
    if (context.hasPhoto()) {
      const size = 100;
      elements.push(...context.photo(context.width - 44 - size, 25, size, mix(context.palette.accent, WHITE, 0.3), GOLD));
      width -= size + 28;
    }
    const header = headerBlock(context, 44, 40, width, "left", { nameSize: 32, nameColor: WHITE, headlineColor: mix(GOLD, WHITE, 0.45), contactColor: WHITE, contacts: false });
    elements.push(...header.elements);
    if (context.profile.name.trim() || context.profile.headline.trim()) elements.push(box("rect", 44, header.bottom + 12, 56, 2, foil("gold", 0)));
    return { elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0 };
  },
  side: ["contact", "skills", "languages", "certificates"],
  title: "underline",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
  contactIcons: true,
  levelBar: "thin",
  photoRing: true,
  skillStyle: "bars",
};

const academic: CvSpec = {
  id: "academic",
  accent: "#7f1d1d",
  fonts: { heading: FONTS.baskerville, body: FONTS.sourceSerif },
  palette: (accent) => lightPalette(accent, { text: "#1c1917", muted: "#44403c", soft: mix(accent, WHITE, 0.72), line: "#d6d3d1" }),
  frame: (context) => single(context, 60),
  header: (context, frame) => {
    const { main } = frame;
    const header = headerBlock(context, main.x, main.top, main.width, "center", { nameSize: 26, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, headlineItalic: true });
    const elements = [...header.elements, rule(main.x, header.bottom + 14, main.width, context.palette.accent, 0.8)];
    return { elements, mainTop: header.bottom + 32, sideTop: main.top };
  },
  side: [],
  title: "rule",
  entry: "dateLeft",
  photo: false,
  skillStyle: "text",
};

const designer: CvSpec = {
  id: "designer",
  accent: "#7c3aed",
  fonts: { heading: FONTS.poppins, body: FONTS.lora },
  palette: (accent) =>
    lightPalette(mix(accent, BLACK, 0.12), {
      text: "#1f2937",
      muted: "#4b5563",
      soft: mix(accent, WHITE, 0.78),
      sideFill: mix(accent, WHITE, 0.9),
      sideText: "#1f2937",
      sideMuted: "#4b5563",
      sideAccent: mix(accent, BLACK, 0.2),
      sideSoft: mix(accent, WHITE, 0.7),
    }),
  frame: (context, pageIndex) => {
    const sideWidth = 214;
    const block = pageIndex === 0 && context.hasPhoto() ? 240 : 0;
    const decor: StudioElement[] = [box("rect", 0, 0, sideWidth, context.height, solid(context.palette.sideFill ?? WHITE))];
    if (block) decor.push(box("rect", 0, 0, sideWidth, block, gradient(150, [mix(context.palette.accent, WHITE, 0.12), mix(context.palette.accent, BLACK, 0.25)])), art("triangleTiles", { primary: WHITE, secondary: WHITE }, 0, 0, sideWidth, block, { opacity: 0.08 }));
    else decor.push(box("rect", 0, 0, sideWidth, 8, solid(context.palette.accent)));
    const frame = sidebarFrame(context, "left", sideWidth, decor, 44);
    if (frame.side && block) frame.side = { ...frame.side, top: block + 30 };
    return frame;
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    if (context.hasPhoto()) {
      const size = 140;
      elements.push(...context.photo((214 - size) / 2, 50, size, mix(context.palette.accent, WHITE, 0.4), WHITE));
    }
    const header = headerBlock(context, frame.main.x, frame.main.top + 6, frame.main.width, "left", { nameSize: 34, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, contacts: false });
    elements.push(...header.elements);
    if (context.profile.name.trim() || context.profile.headline.trim()) {
      elements.push(box("rect", frame.main.x, header.bottom + 14, 34, 6, solid(context.palette.accent), { radius: 3 }), box("rect", frame.main.x + 40, header.bottom + 14, 12, 6, solid(mix(context.palette.accent, WHITE, 0.6)), { radius: 3 }));
    }
    return { elements, mainTop: header.bottom + 40, sideTop: frame.side?.top ?? 0 };
  },
  side: ["contact", "skills", "languages", "interests"],
  title: "leftBar",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
  contactIcons: true,
  levelBar: "segmented",
  photoRing: true,
  skillStyle: "bars",
};

const infographic: CvSpec = {
  id: "infographic",
  accent: "#14b8a6",
  fonts: { heading: FONTS.raleway, body: FONTS.inter },
  palette: (accent) =>
    lightPalette(mix(accent, BLACK, 0.38), {
      text: "#0f172a",
      muted: "#475569",
      soft: mix(accent, WHITE, 0.72),
      sideFill: "#0f172a",
      sideText: "#f1f5f9",
      sideMuted: "#cbd5e1",
      sideAccent: mix(accent, WHITE, 0.15),
      sideSoft: "#334155",
    }),
  frame: (context) =>
    sidebarFrame(
      context,
      "left",
      210,
      [box("rect", 0, 0, 210, context.height, gradient(180, ["#1e293b", "#0f172a"])), art("topographic", { primary: "#334155", secondary: context.palette.sideAccent }, 0, 0, 210, context.height, { opacity: 0.35 })],
      40,
    ),
  header: (context, frame) => {
    const side = frame.side;
    const elements: StudioElement[] = [];
    let sideTop = side?.top ?? 0;
    if (side && context.hasPhoto()) {
      const size = 128;
      elements.push(...context.photo(side.x + (side.width - size) / 2, side.top, size, "#334155", context.palette.sideAccent));
      sideTop = side.top + size + 28;
    }
    const header = headerBlock(context, frame.main.x, frame.main.top, frame.main.width, "left", { nameSize: 32, nameColor: "#0f172a", headlineColor: context.palette.accent, contactColor: "#64748b", upper: true, spacing: 1, contacts: false });
    elements.push(...header.elements);
    if (context.profile.name.trim() || context.profile.headline.trim()) {
      const y = header.bottom + 14;
      elements.push(box("rect", frame.main.x, y, frame.main.width, 4, solid(context.palette.soft), { radius: 2 }), box("rect", frame.main.x, y, frame.main.width * 0.36, 4, solid(context.palette.accent), { radius: 2 }));
    }
    return { elements, mainTop: header.bottom + 36, sideTop };
  },
  side: ["contact", "skills", "languages", "interests"],
  title: "band",
  sideTitle: "band",
  entry: "timeline",
  photo: true,
  contactIcons: true,
  levelBar: "segmented",
  photoRing: true,
  skillStyle: "bars",
};

export const CV_SPECS: Record<CvLayoutId, CvSpec> = { modern, classic, corporate, minimal, creative, timeline, compact, elegant, tech, ats, executive, academic, designer, infographic };

export function specOf(id: CvLayoutId): CvSpec {
  return CV_SPECS[id];
}
