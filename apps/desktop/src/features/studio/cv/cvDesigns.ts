import type { StudioElement } from "@/types/studio";
import { box, FONTS, linear, rule, solid } from "../templates/kit";
import type { CvLayoutId } from "./cvModel";
import { contactLine, mix, textLine, type CvContext, type CvPalette, type CvSpec, type Frame } from "./cvLayout";

const WHITE = "#ffffff";

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

function headerBlock(context: CvContext, x: number, y: number, width: number, align: "left" | "center", options: { nameSize: number; nameColor: string; headlineColor: string; contactColor: string; upper?: boolean; spacing?: number; headlineItalic?: boolean; contacts?: boolean }): { elements: StudioElement[]; bottom: number } {
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
  if (options.contacts !== false) {
    const contacts = textLine(context, x, bottom + 8, width, contactLine(context), { size: context.size(8.6), color: options.contactColor, align, lineHeight: 1.5 });
    if (contacts.element) elements.push(contacts.element);
    bottom = contacts.bottom;
  }
  return { elements, bottom };
}

function sidebarFrame(context: CvContext, side: "left" | "right", sideWidth: number, fill: StudioElement, margin: number): Frame {
  const inner = 22;
  const sideX = side === "left" ? inner : context.width - sideWidth + inner;
  const mainX = side === "left" ? sideWidth + 30 : margin;
  const mainWidth = context.width - sideWidth - 30 - margin;
  return {
    decor: [fill],
    main: { x: mainX, width: mainWidth, top: margin, bottom: context.height - margin },
    side: { x: sideX, width: sideWidth - inner * 2, top: margin, bottom: context.height - margin },
  };
}

const modern: CvSpec = {
  id: "modern",
  accent: "#38bdf8",
  fonts: { heading: FONTS.montserrat, body: FONTS.inter },
  palette: (accent) =>
    lightPalette(mix(accent, "#000000", 0.3), {
      text: "#0f172a",
      muted: "#475569",
      soft: mix(accent, WHITE, 0.75),
      sideFill: "#1e293b",
      sideText: "#f1f5f9",
      sideMuted: "#cbd5e1",
      sideAccent: accent,
      sideSoft: "#334155",
    }),
  frame: (context) => sidebarFrame(context, "left", 196, box("rect", 0, 0, 196, context.height, solid("#1e293b")), 40),
  header: (context, frame) => {
    const side = frame.side;
    const elements: StudioElement[] = [];
    let sideTop = side?.top ?? 0;
    if (side && context.hasPhoto()) {
      const size = 118;
      elements.push(...context.photo(side.x + (side.width - size) / 2, side.top, size, "#334155"));
      sideTop = side.top + size + 22;
    }
    const header = headerBlock(context, frame.main.x, frame.main.top, frame.main.width, "left", { nameSize: 28, nameColor: "#0f172a", headlineColor: context.palette.accent, contactColor: "#64748b", contacts: false });
    elements.push(...header.elements);
    if (context.profile.name.trim() || context.profile.headline.trim()) elements.push(rule(frame.main.x, header.bottom + 14, 48, context.palette.accent, 3));
    return { elements, mainTop: header.bottom + 30, sideTop };
  },
  side: ["contact", "skills", "languages", "interests"],
  title: "rule",
  entry: "timeline",
  photo: true,
};

const classic: CvSpec = {
  id: "classic",
  accent: "#1f3a5f",
  fonts: { heading: FONTS.lora, body: FONTS.sourceSerif },
  palette: (accent) => lightPalette(accent, { text: "#1c1917", muted: "#44403c", soft: "#d6d3d1" }),
  frame: (context) => single(context, 54),
  header: (context, frame) => {
    const { main } = frame;
    const header = headerBlock(context, main.x, main.top, main.width, "center", { nameSize: 26, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted });
    const elements = [...header.elements, rule(main.x, header.bottom + 12, main.width, context.palette.text, 1.4), rule(main.x, header.bottom + 15.5, main.width, context.palette.text, 0.5)];
    return { elements, mainTop: header.bottom + 32, sideTop: main.top };
  },
  side: [],
  title: "rule",
  entry: "stacked",
  photo: false,
};

const corporate: CvSpec = {
  id: "corporate",
  accent: "#0f766e",
  fonts: { heading: FONTS.poppins, body: FONTS.nunito },
  palette: (accent) => lightPalette(accent, { text: "#0f172a", muted: "#475569", sideFill: mix(accent, WHITE, 0.92), sideSoft: mix(accent, WHITE, 0.7) }),
  frame: (context, pageIndex) => {
    const band = pageIndex === 0 ? 132 : 0;
    const sideWidth = 186;
    const sideFill = box("rect", context.width - sideWidth, band, sideWidth, context.height - band, solid(context.palette.sideFill ?? WHITE));
    const decor: StudioElement[] = [sideFill];
    if (band) decor.unshift(box("rect", 0, 0, context.width, band, linear(90, context.palette.accent, mix(context.palette.accent, "#000000", 0.35))));
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
      elements.push(box("ellipse", x - 3, 20 - 3, size + 6, size + 6, solid(WHITE)), ...context.photo(x, 20, size, mix(context.palette.accent, WHITE, 0.45)));
      x += size + 24;
    }
    const header = headerBlock(context, x, 34, context.width - x - 40, "left", { nameSize: 26, nameColor: WHITE, headlineColor: mix(context.palette.accent, WHITE, 0.75), contactColor: WHITE, contacts: false });
    elements.push(...header.elements);
    return { elements, mainTop: frame.main.top, sideTop: frame.side?.top ?? 0 };
  },
  side: ["contact", "skills", "languages", "certificates", "interests"],
  title: "underline",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
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
      width -= size + 20;
    }
    const header = headerBlock(context, main.x, main.top, width, "left", { nameSize: 30, nameColor: context.palette.text, headlineColor: context.palette.muted, contactColor: context.palette.muted });
    elements.push(...header.elements);
    const bottom = Math.max(header.bottom, context.hasPhoto() ? main.top + 78 : 0);
    return { elements, mainTop: bottom + 30, sideTop: main.top };
  },
  side: [],
  title: "plain",
  entry: "dateLeft",
  photo: true,
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
      sideSoft: mix(accent, "#000000", 0.25),
    }),
  frame: (context) => {
    const sideWidth = 200;
    const fill = box("rect", context.width - sideWidth, 0, sideWidth, context.height, linear(160, context.palette.accent, mix(context.palette.accent, "#000000", 0.4)));
    const frame = sidebarFrame(context, "right", sideWidth, fill, 40);
    frame.decor.push(box("ellipse", -60, -60, 150, 150, solid(mix(context.palette.accent, WHITE, 0.88))));
    return frame;
  },
  header: (context, frame) => {
    const elements: StudioElement[] = [];
    let sideTop = frame.side?.top ?? 0;
    if (frame.side && context.hasPhoto()) {
      const size = 120;
      const x = frame.side.x + (frame.side.width - size) / 2;
      elements.push(box("ellipse", x - 4, frame.side.top - 4, size + 8, size + 8, solid(WHITE)), ...context.photo(x, frame.side.top, size, mix(context.palette.accent, WHITE, 0.4)));
      sideTop = frame.side.top + size + 24;
    }
    const header = headerBlock(context, frame.main.x, frame.main.top + 14, frame.main.width, "left", { nameSize: 32, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, contacts: false });
    elements.push(...header.elements);
    return { elements, mainTop: header.bottom + 28, sideTop };
  },
  side: ["contact", "skills", "languages", "interests", "references"],
  title: "leftBar",
  sideTitle: "plain",
  entry: "stacked",
  photo: true,
};

const timeline: CvSpec = {
  id: "timeline",
  accent: "#0d9488",
  fonts: { heading: FONTS.josefin, body: FONTS.nunito },
  palette: (accent) => lightPalette(accent, { text: "#134e4a", muted: "#475569" }),
  frame: (context, pageIndex) => single(context, 50, pageIndex === 0 ? [box("rect", 0, 0, context.width, 8, solid(context.palette.accent))] : []),
  header: (context, frame) => {
    const { main } = frame;
    const elements: StudioElement[] = [];
    let top = main.top;
    if (context.hasPhoto()) {
      const size = 96;
      elements.push(...context.photo(main.x + (main.width - size) / 2, top, size, context.palette.soft));
      top += size + 14;
    }
    const header = headerBlock(context, main.x, top, main.width, "center", { nameSize: 28, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted });
    elements.push(...header.elements);
    return { elements, mainTop: header.bottom + 26, sideTop: main.top };
  },
  side: [],
  title: "leftBar",
  entry: "timeline",
  photo: true,
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
      decor: [],
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
      textWidth -= size + 16;
    }
    const header = headerBlock(context, margin, margin, textWidth, "left", { nameSize: 24, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted });
    elements.push(...header.elements);
    const bottom = Math.max(header.bottom, context.hasPhoto() ? margin + 64 : 0) + 10;
    elements.push(rule(margin, bottom, width, context.palette.line, 1));
    return { elements, mainTop: bottom + 16, sideTop: bottom + 16 };
  },
  side: ["skills", "languages", "certificates", "interests", "references"],
  title: "underline",
  entry: "stacked",
  photo: true,
};

const elegant: CvSpec = {
  id: "elegant",
  accent: "#a16207",
  fonts: { heading: FONTS.cormorant, body: FONTS.garamond },
  palette: (accent) => lightPalette(accent, { page: "#fffdf8", text: "#292524", muted: "#57534e", soft: mix(accent, WHITE, 0.7) }),
  frame: (context) => single(context, 60, [box("rect", 18, 18, context.width - 36, context.height - 36, { type: "none" }, { stroke: { color: mix(context.palette.accent, WHITE, 0.45), width: 0.8, dash: "solid" } })]),
  header: (context, frame) => {
    const { main } = frame;
    const elements: StudioElement[] = [];
    let top = main.top;
    if (context.hasPhoto()) {
      const size = 88;
      elements.push(...context.photo(main.x + (main.width - size) / 2, top, size, context.palette.soft));
      top += size + 14;
    }
    const header = headerBlock(context, main.x, top, main.width, "center", { nameSize: 30, nameColor: context.palette.text, headlineColor: context.palette.accent, contactColor: context.palette.muted, upper: true, spacing: 3, headlineItalic: true });
    elements.push(...header.elements, rule(main.x + main.width / 2 - 70, header.bottom + 14, 140, context.palette.accent, 0.8));
    return { elements, mainTop: header.bottom + 34, sideTop: main.top };
  },
  side: [],
  title: "centered",
  entry: "dateLeft",
  photo: true,
};

const tech: CvSpec = {
  id: "tech",
  accent: "#22c55e",
  fonts: { heading: FONTS.oswald, body: FONTS.inter },
  palette: (accent) => lightPalette(mix(accent, "#000000", 0.25), { text: "#0f172a", muted: "#475569", soft: mix(accent, WHITE, 0.78), sideFill: "#f1f5f9", sideSoft: mix(accent, WHITE, 0.72), sideAccent: mix(accent, "#000000", 0.3) }),
  frame: (context, pageIndex) => {
    const band = pageIndex === 0 ? 124 : 0;
    const sideWidth = 180;
    const decor: StudioElement[] = [box("rect", 0, band, sideWidth, context.height - band, solid("#f1f5f9"))];
    if (band) decor.unshift(box("rect", 0, 0, context.width, band, solid("#0f172a")), box("rect", 0, band - 4, context.width, 4, solid(mix(context.palette.accent, WHITE, 0.2))));
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
      elements.push(...context.photo(x, 21, size, "#1e293b"));
      x += size + 22;
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
};

export const CV_SPECS: Record<CvLayoutId, CvSpec> = { modern, classic, corporate, minimal, creative, timeline, compact, elegant, tech, ats };

export function specOf(id: CvLayoutId): CvSpec {
  return CV_SPECS[id];
}
