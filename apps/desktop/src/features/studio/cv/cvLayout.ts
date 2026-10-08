import type { StudioDesign, StudioElement, StudioTextAlign, StudioTextElement } from "@/types/studio";
import { createImage, STUDIO_PAGE_SIZES } from "../model/design";
import { box, design, pageOf, photoSlot, rule, solid, text } from "../templates/kit";
import { contactIcon } from "./cvIcons";
import { sectionVisible, type CvContactKind, type CvDensity, type CvLayoutId, type CvPhotoShape, type CvProfile, type CvSectionKey, type CvSkillStyle, type CvTheme } from "./cvModel";

export type CvMeasure = (element: StudioTextElement) => number;

export type CvLabels = {
  sections: Record<CvSectionKey | "contact", string>;
  present: string;
  levels: string[];
  languageLevels: string[];
  contacts: Record<CvContactKind, string>;
};

export type CvPalette = {
  page: string;
  text: string;
  muted: string;
  accent: string;
  soft: string;
  line: string;
  sideFill: string | null;
  sideText: string;
  sideMuted: string;
  sideAccent: string;
  sideSoft: string;
};

export type Tone = "main" | "side";
export type TitleStyle = "rule" | "band" | "underline" | "leftBar" | "plain" | "centered";
export type EntryStyle = "stacked" | "dateLeft" | "timeline";

export type Column = { x: number; width: number; top: number; bottom: number };
export type Frame = { decor: StudioElement[]; main: Column; side: Column | null };
export type HeaderResult = { elements: StudioElement[]; mainTop: number; sideTop: number };

export type CvFonts = { heading: string; body: string };
export type LevelBar = "line" | "thin" | "segmented";

export type CvSpec = {
  id: CvLayoutId;
  accent: string;
  fonts: CvFonts;
  palette: (accent: string) => CvPalette;
  frame: (context: CvContext, pageIndex: number) => Frame;
  header: (context: CvContext, frame: Frame) => HeaderResult;
  side: ReadonlyArray<CvSectionKey | "contact">;
  title: TitleStyle;
  sideTitle?: TitleStyle;
  entry: EntryStyle;
  photo: boolean;
  contactIcons?: boolean;
  levelBar?: LevelBar;
  photoRing?: boolean;
  skillStyle?: CvSkillStyle;
};

export type CvInput = { profile: CvProfile; theme: CvTheme; labels: CvLabels; measure: CvMeasure; emptyPhoto: boolean; name: string };

type Block = { height: number; draw: (x: number, y: number, width: number) => StudioElement[]; split?: (available: number) => [Block, Block] | null };

export type CvOverflow = { items: number; sections: CvSectionKey[] };
export type CvComposed = { design: StudioDesign; overflow: CvOverflow };

export type TextStyle = { font?: string; size: number; color: string; bold?: boolean; italic?: boolean; upper?: boolean; spacing?: number; lineHeight?: number; align?: StudioTextAlign };

export const MAX_CV_PAGES = 20;
const MIN_SPLIT_SPACE = 48;
const DENSITY: Record<CvDensity, { type: number; gap: number }> = { compact: { type: 0.92, gap: 0.72 }, normal: { type: 1, gap: 1 }, roomy: { type: 1.06, gap: 1.3 } };
const BULLET = /^\s*[-*•–]\s+/;
const DATE_WIDTH = 92;
const DATE_COLUMN = 84;
const TIMELINE_GUTTER = 18;
const BAR_HEIGHT = 4.5;
const DOT_SIZE = 6;
const DOT_GAP = 3.5;
const THIN_BAR = 2.5;
const SEGMENT_GAP = 2.5;
const RING_GAP = 3;

export function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const [a, b] = [parse(from), parse(to)];
  return `#${a.map((value, index) => Math.round(value + ((b[index] ?? value) - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export class CvContext {
  readonly profile: CvProfile;
  readonly theme: CvTheme;
  readonly labels: CvLabels;
  readonly palette: CvPalette;
  readonly fonts: CvFonts;
  readonly width: number;
  readonly height: number;
  readonly emptyPhoto: boolean;
  readonly scale: number;
  readonly gap: number;
  readonly contactIcons: boolean;
  readonly levelBar: LevelBar;
  private readonly photoRing: boolean;
  private readonly measure: CvMeasure;
  private readonly allowPhoto: boolean;

  constructor(spec: CvSpec, input: CvInput) {
    this.profile = input.profile;
    this.theme = input.theme;
    this.labels = input.labels;
    this.measure = input.measure;
    this.emptyPhoto = input.emptyPhoto;
    this.allowPhoto = spec.photo;
    this.contactIcons = spec.contactIcons ?? false;
    this.levelBar = spec.levelBar ?? "line";
    this.photoRing = spec.photoRing ?? false;
    this.palette = spec.palette(input.theme.accent ?? spec.accent);
    this.fonts = { heading: input.theme.headingFont ?? spec.fonts.heading, body: input.theme.bodyFont ?? spec.fonts.body };
    const size = STUDIO_PAGE_SIZES[input.theme.paper];
    this.width = size.width;
    this.height = size.height;
    this.scale = DENSITY[input.theme.density].type;
    this.gap = DENSITY[input.theme.density].gap;
  }

  size(value: number): number {
    return Math.round(value * this.scale * 10) / 10;
  }

  space(value: number): number {
    return value * this.gap;
  }

  text(x: number, y: number, width: number, value: string, style: TextStyle): StudioTextElement {
    const element = text(x, y, Math.max(width, 4), 2000, value, {
      font: style.font ?? this.fonts.body,
      size: style.size,
      color: style.color,
      bold: style.bold,
      italic: style.italic,
      upper: style.upper,
      spacing: style.spacing,
      lineHeight: style.lineHeight ?? 1.35,
      align: style.align,
    });
    element.height = Math.ceil(this.measure(element)) + 1;
    return element;
  }

  textHeight(width: number, value: string, style: TextStyle): number {
    return value.trim() ? this.text(0, 0, width, value, style).height : 0;
  }

  photo(x: number, y: number, side: number, backing: string, ring = this.palette.accent): StudioElement[] {
    const shape: CvPhotoShape = this.theme.photoShape;
    if (!this.hasPhoto()) return [];
    const mask = shape === "circle" ? "circle" : shape === "rounded" ? "rounded" : "none";
    const frame = this.photoRing ? [this.ring(x, y, side, mask, ring)] : [];
    if (this.profile.photo) {
      const image = createImage(this.profile.photo, x, y, side, side);
      return [...frame, { ...image, crop: this.profile.photoCrop ?? image.crop, mask, cornerRadius: mask === "rounded" ? side * 0.12 : 0 }];
    }
    return this.emptyPhoto ? [...frame, ...photoSlot(x, y, side, side, backing, mask)] : frame;
  }

  private ring(x: number, y: number, side: number, mask: "circle" | "rounded" | "none", color: string): StudioElement {
    const outer = side + RING_GAP * 2;
    const stroke = { color, width: 1.6, dash: "solid" as const };
    return mask === "circle" ? box("ellipse", x - RING_GAP, y - RING_GAP, outer, outer, { type: "none" }, { stroke }) : box("rect", x - RING_GAP, y - RING_GAP, outer, outer, { type: "none" }, { stroke, radius: mask === "rounded" ? side * 0.12 + RING_GAP : 0 });
  }

  hasPhoto(): boolean {
    return this.allowPhoto && this.theme.photoShape !== "none" && (Boolean(this.profile.photo) || this.emptyPhoto);
  }

  contacts(): Array<{ kind: CvContactKind; value: string }> {
    return this.profile.contacts.filter((contact) => contact.value.trim()).map((contact) => ({ kind: contact.kind, value: contact.value.trim() }));
  }

  colors(tone: Tone) {
    const palette = this.palette;
    return tone === "side"
      ? { text: palette.sideText, muted: palette.sideMuted, accent: palette.sideAccent, soft: palette.sideSoft }
      : { text: palette.text, muted: palette.muted, accent: palette.accent, soft: palette.soft };
  }
}

function details(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1))
    .map((line) => (BULLET.test(line) ? `• ${line.replace(BULLET, "")}` : line))
    .join("\n");
}

function period(start: string, end: string, current: boolean, present: string): string {
  const finish = current ? present : end.trim();
  const begin = start.trim();
  if (begin && finish) return `${begin} – ${finish}`;
  return begin || finish;
}

function join(parts: string[], separator = " · "): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(separator);
}

function stack(rows: Array<Block | null>, spacing: number): Block {
  const present = rows.filter((row): row is Block => row !== null && row.height > 0);
  const height = present.reduce((sum, row) => sum + row.height, 0) + spacing * Math.max(0, present.length - 1);
  return {
    height,
    draw: (x, y, width) => {
      let top = y;
      const elements: StudioElement[] = [];
      for (const row of present) {
        elements.push(...row.draw(x, top, width));
        top += row.height + spacing;
      }
      return elements;
    },
  };
}

function textBlock(context: CvContext, width: number, value: string, style: TextStyle): Block | null {
  if (!value.trim()) return null;
  const height = context.textHeight(width, value, style);
  return { height, draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, value, style)] };
}

export function titleBlock(context: CvContext, tone: Tone, style: TitleStyle, label: string, width: number): Block {
  const colors = context.colors(tone);
  const font = context.fonts.heading;
  const size = context.size(style === "underline" || style === "leftBar" ? 13 : 10.5);
  if (style === "band") {
    const height = context.size(10.5) + 12;
    return {
      height,
      draw: (x, y, columnWidth) => [
        box("rect", x, y, columnWidth, height, solid(colors.accent), { radius: 3 }),
        text(x + 9, y, columnWidth - 18, height, label, { font, size: context.size(10), bold: true, upper: true, spacing: 1.6, color: tone === "side" ? context.palette.sideFill ?? "#ffffff" : "#ffffff", valign: "middle", shrink: true }),
      ],
    };
  }
  const textStyle: TextStyle = {
    font,
    size,
    bold: true,
    color: style === "plain" ? colors.muted : style === "underline" || style === "leftBar" ? colors.text : colors.accent,
    upper: style !== "underline" && style !== "leftBar",
    spacing: style === "underline" || style === "leftBar" ? 0 : 1.8,
    align: style === "centered" ? "center" : "left",
  };
  const labelHeight = context.textHeight(width, label, textStyle);
  if (style === "leftBar") {
    return {
      height: labelHeight,
      draw: (x, y, columnWidth) => [box("rect", x, y + 1, 4, labelHeight - 2, solid(colors.accent), { radius: 2 }), context.text(x + 12, y, columnWidth - 12, label, textStyle)],
    };
  }
  if (style === "underline") {
    return { height: labelHeight + 7, draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, label, textStyle), box("rect", x, y + labelHeight + 2, 28, 3, solid(colors.accent), { radius: 1.5 })] };
  }
  if (style === "rule") {
    return { height: labelHeight + 7, draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, label, textStyle), rule(x, y + labelHeight + 3, columnWidth, colors.soft, 1)] };
  }
  if (style === "centered") {
    return {
      height: labelHeight + 8,
      draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, label, textStyle), rule(x + columnWidth / 2 - 22, y + labelHeight + 4, 44, colors.accent, 1.2)],
    };
  }
  return { height: labelHeight, draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, label, textStyle)] };
}

function headlineRow(context: CvContext, tone: Tone, width: number, title: string, date: string, size: number): Block | null {
  if (!title.trim() && !date.trim()) return null;
  const colors = context.colors(tone);
  const dateStyle: TextStyle = { size: context.size(8.5), color: colors.muted, align: "right" };
  const titleStyle: TextStyle = { font: context.fonts.heading, size, bold: true, color: colors.text };
  const narrow = width < 200 || !date.trim();
  if (narrow) return stack([textBlock(context, width, title, titleStyle), date.trim() && width < 200 ? textBlock(context, width, date, { ...dateStyle, align: "left" }) : null], 1);
  const titleHeight = context.textHeight(width - DATE_WIDTH - 6, title, titleStyle);
  const dateHeight = context.textHeight(DATE_WIDTH, date, dateStyle);
  return {
    height: Math.max(titleHeight, dateHeight),
    draw: (x, y, columnWidth) => [
      ...(title.trim() ? [context.text(x, y, columnWidth - DATE_WIDTH - 6, title, titleStyle)] : []),
      context.text(x + columnWidth - DATE_WIDTH, y + 1, DATE_WIDTH, date, dateStyle),
    ],
  };
}

type EntryParts = { title: string; subtitle: string; date: string; body: string };

function bodyLines(body: string): string[] {
  return body.split("\n");
}

function trimmedLines(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  return lines.slice(start);
}

function splittable(build: (body: string, first: boolean) => Block | null, lines: string[], first: boolean): Block | null {
  const whole = build(lines.join("\n"), first);
  if (!whole || lines.length < 2) return whole;
  return {
    ...whole,
    split: (available) => {
      for (let count = lines.length - 1; count >= 1; count -= 1) {
        if (!lines[count - 1].trim()) continue;
        const head = build(lines.slice(0, count).join("\n"), first);
        if (!head || head.height > available) continue;
        const rest = splittable(build, trimmedLines(lines.slice(count)), false);
        return rest ? [head, rest] : null;
      }
      return null;
    },
  };
}

function entryBlock(context: CvContext, tone: Tone, style: EntryStyle, width: number, parts: EntryParts): Block | null {
  const lines = bodyLines(parts.body);
  return splittable((body, first) => entryPart(context, tone, style, width, first ? { ...parts, body } : { title: "", subtitle: "", date: "", body }, first), lines, true);
}

function entryPart(context: CvContext, tone: Tone, style: EntryStyle, width: number, parts: EntryParts, first: boolean): Block | null {
  const colors = context.colors(tone);
  const bodyStyle: TextStyle = { size: context.size(9), color: colors.muted, lineHeight: 1.45 };
  const subtitleStyle: TextStyle = { size: context.size(9), color: colors.accent, italic: style !== "dateLeft", bold: style === "dateLeft" };
  const titleSize = context.size(10.5);
  if (style === "dateLeft" && width >= 260 && !first) {
    const inner = width - DATE_COLUMN;
    const right = textBlock(context, inner, parts.body, bodyStyle);
    return right ? { height: right.height, draw: (x, y, columnWidth) => right.draw(x + DATE_COLUMN, y, columnWidth - DATE_COLUMN) } : null;
  }
  if (style === "dateLeft" && width >= 260 && parts.date.trim()) {
    const inner = width - DATE_COLUMN;
    const right = stack([textBlock(context, inner, parts.title, { font: context.fonts.heading, size: titleSize, bold: true, color: colors.text }), textBlock(context, inner, parts.subtitle, subtitleStyle), textBlock(context, inner, parts.body, bodyStyle)], 2);
    const dateHeight = context.textHeight(DATE_COLUMN - 10, parts.date, { size: context.size(8.5), color: colors.muted });
    return {
      height: Math.max(right.height, dateHeight),
      draw: (x, y, columnWidth) => [context.text(x, y + 1, DATE_COLUMN - 10, parts.date, { size: context.size(8.5), color: colors.muted }), ...right.draw(x + DATE_COLUMN, y, columnWidth - DATE_COLUMN)],
    };
  }
  const contentWidth = style === "timeline" ? width - TIMELINE_GUTTER : width;
  const content = stack([headlineRow(context, tone, contentWidth, parts.title, parts.date, titleSize), textBlock(context, contentWidth, parts.subtitle, subtitleStyle), textBlock(context, contentWidth, parts.body, bodyStyle)], 2);
  if (content.height === 0) return null;
  if (style !== "timeline") return content;
  return {
    height: content.height,
    draw: (x, y, columnWidth) => [
      box("rect", x + 3.4, first ? y + 9 : y, 1.2, Math.max(0, first ? content.height - 4 : content.height + 5), solid(colors.soft)),
      ...(first ? [box("ellipse", x, y + 2.5, 8, 8, solid(colors.accent))] : []),
      ...content.draw(x + TIMELINE_GUTTER, y, columnWidth - TIMELINE_GUTTER),
    ],
  };
}

function levelBlock(context: CvContext, tone: Tone, style: CvSkillStyle, width: number, name: string, level: number, levelLabel: string): Block | null {
  if (!name.trim()) return null;
  const colors = context.colors(tone);
  const nameStyle: TextStyle = { size: context.size(9), color: colors.text };
  if (style === "text" || level <= 0) {
    const label = style === "text" && level > 0 && levelLabel ? `${name} — ${levelLabel}` : name;
    return textBlock(context, width, label, nameStyle);
  }
  if (style === "dots") {
    const dots = 5 * DOT_SIZE + 4 * DOT_GAP;
    const nameWidth = Math.max(40, width - dots - 8);
    const height = Math.max(context.textHeight(nameWidth, name, nameStyle), DOT_SIZE + 2);
    return {
      height,
      draw: (x, y, columnWidth) => [
        context.text(x, y, columnWidth - dots - 8, name, nameStyle),
        ...Array.from({ length: 5 }, (_, index) => box("ellipse", x + columnWidth - dots + index * (DOT_SIZE + DOT_GAP), y + (height - DOT_SIZE) / 2, DOT_SIZE, DOT_SIZE, solid(index < level ? colors.accent : colors.soft))),
      ],
    };
  }
  const nameHeight = context.textHeight(width, name, nameStyle);
  const bar = context.levelBar === "thin" ? THIN_BAR : BAR_HEIGHT;
  return {
    height: nameHeight + 3 + bar,
    draw: (x, y, columnWidth) => [context.text(x, y, columnWidth, name, nameStyle), ...levelTrack(context.levelBar, x, y + nameHeight + 3, columnWidth, bar, level, colors)],
  };
}

function levelTrack(style: LevelBar, x: number, y: number, width: number, height: number, level: number, colors: { accent: string; soft: string }): StudioElement[] {
  if (style === "segmented") {
    const segment = (width - SEGMENT_GAP * 4) / 5;
    return Array.from({ length: 5 }, (_, index) => box("rect", x + index * (segment + SEGMENT_GAP), y, segment, height, solid(index < level ? colors.accent : colors.soft), { radius: 1 }));
  }
  return [box("rect", x, y, width, height, solid(colors.soft), { radius: height / 2 }), box("rect", x, y, (width * level) / 5, height, solid(colors.accent), { radius: height / 2 })];
}

function chipsBlock(context: CvContext, tone: Tone, width: number, items: string[]): Block | null {
  const names = items.map((item) => item.trim()).filter(Boolean);
  if (!names.length) return null;
  const colors = context.colors(tone);
  const size = context.size(8.5);
  const height = size + 9;
  const placed: Array<{ x: number; y: number; width: number; label: string }> = [];
  let left = 0;
  let top = 0;
  for (const label of names) {
    const chipWidth = Math.min(width, label.length * size * 0.56 + 16);
    if (left > 0 && left + chipWidth > width) {
      left = 0;
      top += height + 5;
    }
    placed.push({ x: left, y: top, width: chipWidth, label });
    left += chipWidth + 5;
  }
  return {
    height: top + height,
    draw: (x, y) =>
      placed.flatMap((chip) => [
        box("rect", x + chip.x, y + chip.y, chip.width, height, solid(colors.soft), { radius: height / 2 }),
        text(x + chip.x + 4, y + chip.y, chip.width - 8, height, chip.label, { font: context.fonts.body, size, color: colors.text, align: "center", valign: "middle", shrink: true }),
      ]),
  };
}

function iconRow(context: CvContext, width: number, kind: CvContactKind, value: string, color: string, iconColor: string): Block | null {
  const size = context.size(8.8);
  const icon = Math.round(size * 1.15 * 10) / 10;
  const indent = icon + 7;
  const style: TextStyle = { size, color };
  const textHeight = context.textHeight(width - indent, value, style);
  if (!textHeight) return null;
  const offset = Math.max(0, (Math.min(textHeight, size * 1.35) - icon) / 2);
  return { height: Math.max(textHeight, icon), draw: (x, y, columnWidth) => [contactIcon(kind, iconColor, x, y + offset, icon), context.text(x + indent, y, columnWidth - indent, value, style)] };
}

export function contactGrid(context: CvContext, x: number, y: number, width: number, columns: number, color: string, iconColor: string): { elements: StudioElement[]; bottom: number } {
  const items = context.contacts();
  if (!items.length) return { elements: [], bottom: y };
  const count = Math.max(1, Math.min(columns, items.length));
  const gutter = 14;
  const cell = (width - gutter * (count - 1)) / count;
  const elements: StudioElement[] = [];
  let top = y;
  for (let start = 0; start < items.length; start += count) {
    const rows = items.slice(start, start + count).map((item) => iconRow(context, cell, item.kind, item.value, color, iconColor));
    const height = Math.max(0, ...rows.map((row) => row?.height ?? 0));
    rows.forEach((row, index) => row && elements.push(...row.draw(x + index * (cell + gutter), top, cell)));
    top += height + 6;
  }
  return { elements, bottom: top - 6 };
}

function contactBlocks(context: CvContext, tone: Tone, width: number): Block[] {
  const colors = context.colors(tone);
  if (context.contactIcons) return context.contacts().flatMap(({ kind, value }) => iconRow(context, width, kind, value, colors.text, colors.accent) ?? []);
  return context.contacts().map(({ kind, value }) =>
    stack([textBlock(context, width, context.labels.contacts[kind], { size: context.size(7), color: colors.accent, bold: true, upper: true, spacing: 1.2 }), textBlock(context, width, value, { size: context.size(8.8), color: colors.text })], 1),
  );
}

type Section = { key: CvSectionKey | "contact"; title: string; items: Block[]; gap: number };

function sectionsFor(context: CvContext, spec: CvSpec, tone: Tone, width: number): Section[] {
  const { profile, labels } = context;
  const style = context.theme.skillStyle;
  const entry = tone === "side" ? "stacked" : spec.entry;
  const itemGap = context.space(tone === "side" ? 7 : 10);
  const colors = context.colors(tone);
  const paragraph: TextStyle = { size: context.size(9.2), color: colors.muted, lineHeight: 1.5 };
  const keys: Array<CvSectionKey | "contact"> = [];
  if (tone === "side" && spec.side.includes("contact")) keys.push("contact");
  for (const key of profile.order) {
    const onSide = spec.side.includes(key);
    if ((tone === "side") === onSide && sectionVisible(profile, key)) keys.push(key);
  }
  const sections: Section[] = [];
  const add = (key: CvSectionKey | "contact", items: Array<Block | null>, title = labels.sections[key]) => {
    const present = items.filter((item): item is Block => item !== null && item.height > 0);
    if (present.length) sections.push({ key, title, items: present, gap: itemGap });
  };
  for (const key of keys) {
    if (key === "contact") add(key, contactBlocks(context, tone, width));
    else if (key === "summary") add(key, [textBlock(context, width, profile.summary, paragraph)]);
    else if (key === "experience")
      add(
        key,
        profile.experience.map((item) => entryBlock(context, tone, entry, width, { title: item.role, subtitle: join([item.organisation, item.location]), date: period(item.start, item.end, item.current, labels.present), body: details(item.details) })),
      );
    else if (key === "education")
      add(key, profile.education.map((item) => entryBlock(context, tone, entry, width, { title: item.degree, subtitle: join([item.school, item.location]), date: period(item.start, item.end, item.current, labels.present), body: details(item.details) })));
    else if (key === "skills") {
      const skills = profile.skills.filter((item) => item.name.trim());
      if (style === "chips") add(key, [chipsBlock(context, tone, width, skills.map((item) => item.name))]);
      else if (style === "text" && skills.every((item) => item.level <= 0)) add(key, [textBlock(context, width, skills.map((item) => item.name).join(", "), paragraph)]);
      else add(key, skills.map((item) => levelBlock(context, tone, style, width, item.name, item.level, labels.levels[item.level - 1] ?? "")));
    } else if (key === "languages")
      add(
        key,
        profile.languages.filter((item) => item.name.trim()).map((item) => levelBlock(context, tone, style === "chips" ? "text" : style, width, item.name, item.level, labels.languageLevels[item.level - 1] ?? "")),
      );
    else if (key === "certificates")
      add(
        key,
        profile.certificates.map((item) =>
          item.name.trim() ? stack([textBlock(context, width, item.name, { size: context.size(9.4), bold: true, color: colors.text }), textBlock(context, width, join([item.issuer, item.date]), { size: context.size(8.6), color: colors.muted })], 1) : null,
        ),
      );
    else if (key === "projects")
      add(
        key,
        profile.projects.map((item) =>
          item.name.trim() || item.details.trim()
            ? stack([textBlock(context, width, item.name, { font: context.fonts.heading, size: context.size(10), bold: true, color: colors.text }), textBlock(context, width, item.link, { size: context.size(8.5), color: colors.accent }), textBlock(context, width, details(item.details), paragraph)], 2)
            : null,
        ),
      );
    else if (key === "references")
      add(
        key,
        profile.references.map((item) =>
          item.name.trim() ? stack([textBlock(context, width, item.name, { size: context.size(9.4), bold: true, color: colors.text }), textBlock(context, width, item.role, { size: context.size(8.6), color: colors.accent }), textBlock(context, width, item.contact, { size: context.size(8.6), color: colors.muted })], 1) : null,
        ),
      );
    else if (key === "interests") {
      const interests = profile.interests.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
      add(key, [style === "chips" ? chipsBlock(context, tone, width, interests) : textBlock(context, width, interests.join(", "), paragraph)]);
    } else if (key === "custom") {
      for (const item of profile.custom) {
        if (!item.heading.trim() && !item.body.trim()) continue;
        add(key, [textBlock(context, width, details(item.body), paragraph)], item.heading.trim() || labels.sections.custom);
      }
    }
  }
  return sections;
}

class Flow {
  readonly pages: StudioElement[][] = [];
  private readonly frames: Frame[] = [];
  private readonly cursor: Record<Tone, { page: number; y: number }>;

  constructor(
    private readonly context: CvContext,
    private readonly spec: CvSpec,
  ) {
    const first = this.frame(0);
    const header = spec.header(context, first);
    this.pages[0].push(...header.elements);
    this.cursor = { main: { page: 0, y: header.mainTop }, side: { page: 0, y: header.sideTop } };
  }

  frame(index: number): Frame {
    while (this.frames.length <= index) {
      const frame = this.spec.frame(this.context, this.frames.length);
      this.frames.push(frame);
      this.pages.push([...frame.decor]);
    }
    return this.frames[index];
  }

  column(tone: Tone, page: number): Column | null {
    const frame = this.frame(page);
    return tone === "side" ? frame.side : frame.main;
  }

  place(tone: Tone, block: Block, keep = 0): boolean {
    const cursor = this.cursor[tone];
    const column = this.column(tone, cursor.page);
    if (!column) return false;
    if (cursor.y + block.height + keep > column.bottom) {
      const available = column.bottom - cursor.y;
      const parts = available >= MIN_SPLIT_SPACE || cursor.y <= column.top + 1 ? block.split?.(available) : null;
      if (parts) {
        this.pages[cursor.page].push(...parts[0].draw(column.x, cursor.y, column.width));
        cursor.y += parts[0].height;
        if (!this.nextPage(tone)) return false;
        return this.place(tone, parts[1], keep);
      }
      if (cursor.y > column.top + 1) {
        if (!this.nextPage(tone)) return false;
        return this.place(tone, block, keep);
      }
    }
    this.pages[cursor.page].push(...block.draw(column.x, cursor.y, column.width));
    cursor.y += block.height;
    return true;
  }

  private nextPage(tone: Tone): boolean {
    const cursor = this.cursor[tone];
    if (cursor.page + 1 >= MAX_CV_PAGES) return false;
    const column = this.column(tone, cursor.page + 1);
    if (!column) return false;
    cursor.page += 1;
    cursor.y = column.top;
    return true;
  }

  advance(tone: Tone, amount: number) {
    this.cursor[tone].y += amount;
  }

  width(tone: Tone): number {
    return this.column(tone, 0)?.width ?? 0;
  }
}

function keepWithTitle(block: Block | undefined, column: number): number {
  if (!block) return 0;
  return Math.min(block.height, column / 3);
}

export function composeCvReport(spec: CvSpec, input: CvInput): CvComposed {
  const context = new CvContext(spec, input);
  const flow = new Flow(context, spec);
  const overflow: CvOverflow = { items: 0, sections: [] };
  const drop = (section: Section, count: number) => {
    if (count <= 0) return;
    overflow.items += count;
    if (section.key !== "contact" && !overflow.sections.includes(section.key)) overflow.sections.push(section.key);
  };
  for (const tone of ["main", "side"] as const) {
    const width = flow.width(tone);
    if (width <= 0) continue;
    const titleStyle = tone === "side" ? (spec.sideTitle ?? spec.title) : spec.title;
    const sectionGap = context.space(tone === "side" ? 16 : 18);
    const column = flow.column(tone, 0);
    const columnHeight = column ? column.bottom - column.top : 0;
    const sections = sectionsFor(context, spec, tone, width);
    for (const [sectionIndex, section] of sections.entries()) {
      const title = titleBlock(context, tone, titleStyle, section.title, width);
      if (!flow.place(tone, title, keepWithTitle(section.items[0], columnHeight) + context.space(8))) {
        for (const rest of sections.slice(sectionIndex)) drop(rest, rest.items.length);
        break;
      }
      flow.advance(tone, context.space(8));
      let placed = section.items.length;
      for (const [index, item] of section.items.entries()) {
        if (!flow.place(tone, item)) {
          placed = index;
          break;
        }
        if (index < section.items.length - 1) flow.advance(tone, section.gap);
      }
      if (placed < section.items.length) {
        drop(section, section.items.length - placed);
        for (const rest of sections.slice(sectionIndex + 1)) drop(rest, rest.items.length);
        break;
      }
      flow.advance(tone, sectionGap);
    }
  }
  const pages = flow.pages.map((elements) => pageOf({ width: context.width, height: context.height }, solid(context.palette.page), elements));
  return { design: design(input.name, [context.palette.accent, context.palette.text], pages), overflow };
}

export function composeCv(spec: CvSpec, input: CvInput): StudioDesign {
  return composeCvReport(spec, input).design;
}

export function textLine(context: CvContext, x: number, y: number, width: number, value: string, style: TextStyle): { element: StudioTextElement | null; bottom: number } {
  if (!value.trim()) return { element: null, bottom: y };
  const element = context.text(x, y, width, value, style);
  return { element, bottom: y + element.height };
}

export function contactLine(context: CvContext, separator = "   •   "): string {
  return context.contacts().map((contact) => contact.value).join(separator);
}

