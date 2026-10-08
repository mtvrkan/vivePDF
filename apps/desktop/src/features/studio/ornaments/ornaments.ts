import type { StudioVectorPath } from "@/types/studio";
import { arc, circle, mapPoints, perimeter, polar, polyline, rotateAround, roundedRectangleAt, sampled, seeded, smooth, type Point, type Segment } from "./geometry";
import { darker, fourCorners, lighter, line, mirrored, NONE, rectangle, shape, solid, TAU, type OrnamentColors, type VectorArt } from "./paint";
import { PREMIUM_ORNAMENTS } from "./premiumOrnaments";

export type { OrnamentColors, VectorArt } from "./paint";

export type OrnamentCategory = "frames" | "seals" | "dividers" | "accents" | "patterns";

export type Ornament = {
  id: string;
  category: OrnamentCategory;
  fitsPage: boolean;
  size: { width: number; height: number };
  build: (colors: OrnamentColors, size: { width: number; height: number }) => VectorArt;
};

export const DEFAULT_COLOURS: OrnamentColors = { primary: "#1f4e8c", secondary: "#c9a227" };

export function paletteColours(palette: string[] | undefined): OrnamentColors {
  return { primary: palette?.[0] ?? DEFAULT_COLOURS.primary, secondary: palette?.[1] ?? DEFAULT_COLOURS.secondary };
}

function guillocheRosette(colors: OrnamentColors): VectorArt {
  const paths: StudioVectorPath[] = [];
  const rings = [
    { radius: 70, depth: 13, waves: 18, layers: 6, width: 0.55 },
    { radius: 43, depth: 8, waves: 12, layers: 5, width: 0.5 },
  ];
  for (const ring of rings) {
    for (let layer = 0; layer < ring.layers; layer += 1) {
      const shift = (TAU / ring.waves) * (layer / ring.layers);
      const curve = sampled(ring.waves * 40, (t) => polar(100, 100, ring.radius + ring.depth * Math.cos(ring.waves * (t * TAU - shift)), t * TAU));
      paths.push(shape(curve, NONE, line(layer % 2 ? colors.secondary : colors.primary, ring.width)));
    }
  }
  paths.push(shape(circle(100, 100, 88), NONE, line(colors.primary, 1.4)));
  paths.push(shape(circle(100, 100, 30), NONE, line(colors.primary, 0.9)));
  return { viewWidth: 200, viewHeight: 200, paths };
}

function guillocheFrame(colors: OrnamentColors, size: { width: number; height: number }): VectorArt {
  const { width, height } = size;
  const short = Math.min(width, height);
  const margin = short * 0.04;
  const band = short * 0.045;
  const middle = { x: margin + band / 2, y: margin + band / 2, width: width - 2 * margin - band, height: height - 2 * margin - band };
  const along = roundedRectangleAt(middle.x, middle.y, middle.width, middle.height, band);
  const length = perimeter(middle.width, middle.height, band);
  const waves = Math.max(8, Math.round(length / (band * 1.3)));
  const paths: StudioVectorPath[] = [];
  const layers = 4;
  for (let layer = 0; layer < layers; layer += 1) {
    const shift = (TAU * layer) / layers;
    const curve = sampled(waves * 18, (t) => {
      const { point, normal } = along(t);
      const offset = (band / 2) * 0.92 * Math.sin(waves * TAU * t + shift);
      return [point[0] + normal[0] * offset, point[1] + normal[1] * offset];
    });
    paths.push(shape(curve, NONE, line(layer % 2 ? colors.secondary : colors.primary, 0.5)));
  }
  const outer = rectangle(margin, margin, width - 2 * margin, height - 2 * margin);
  const inner = rectangle(margin + band, margin + band, width - 2 * (margin + band), height - 2 * (margin + band));
  const hairline = rectangle(margin + band + 5, margin + band + 5, width - 2 * (margin + band + 5), height - 2 * (margin + band + 5));
  paths.push(shape(outer, NONE, line(colors.primary, 1.6)), shape(inner, NONE, line(colors.primary, 0.9)), shape(hairline, NONE, line(colors.secondary, 0.4)));
  return { viewWidth: width, viewHeight: height, paths };
}

function doubleFrame(colors: OrnamentColors, size: { width: number; height: number }): VectorArt {
  const { width, height } = size;
  const margin = Math.min(width, height) * 0.035;
  const gap = 7;
  const diamond = (cx: number, cy: number, r: number): Segment[] =>
    polyline(
      [
        [cx, cy - r],
        [cx + r, cy],
        [cx, cy + r],
        [cx - r, cy],
      ],
      true,
    );
  const inner = margin + gap;
  const corners = fourCorners(diamond(inner, inner, 6), width, height);
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), NONE, line(colors.primary, 4)),
      shape(rectangle(inner, inner, width - 2 * inner, height - 2 * inner), NONE, line(colors.primary, 1)),
      shape(corners, solid(colors.secondary)),
    ],
  };
}

function flourishPiece(scale: number, offset: number): Segment[] {
  const curl: Point[] = [
    [92, 4],
    [52, 3],
    [22, 7],
    [9, 20],
    [10, 36],
    [22, 44],
    [34, 38],
    [34, 26],
    [25, 22],
    [19, 28],
  ];
  const leaf: Point[] = [
    [40, 12],
    [52, 10],
    [62, 16],
    [52, 20],
    [40, 12],
  ];
  const transform = ([x, y]: Point): Point => [offset + x * scale, offset + y * scale];
  const swap = ([x, y]: Point): Point => [y, x];
  return [
    ...mapPoints(smooth(curl), transform),
    ...mapPoints(smooth(curl.map(swap)), transform),
    ...mapPoints(smooth(leaf, true), transform),
    ...mapPoints(smooth(leaf.map(swap), true), transform),
    ...mapPoints(circle(5, 5, 3.2), transform),
  ];
}

function ornateFrame(colors: OrnamentColors, size: { width: number; height: number }): VectorArt {
  const { width, height } = size;
  const short = Math.min(width, height);
  const margin = short * 0.045;
  const scale = (short * 0.2) / 92;
  const corners = fourCorners(flourishPiece(scale, margin + 8), width, height);
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), NONE, line(colors.primary, 1.2)),
      shape(rectangle(margin + 4, margin + 4, width - 2 * margin - 8, height - 2 * margin - 8), NONE, line(colors.primary, 0.4)),
      shape(corners, NONE, line(colors.secondary, 1.3)),
    ],
  };
}

function decoFrame(colors: OrnamentColors, size: { width: number; height: number }): VectorArt {
  const { width, height } = size;
  const margin = Math.min(width, height) * 0.05;
  const arm = Math.min(width, height) * 0.14;
  const step = 7;
  const piece: Segment[] = [
    ...polyline([
      [margin, margin + arm],
      [margin, margin],
      [margin + arm, margin],
    ]),
    ...polyline([
      [margin + step, margin + arm * 0.75],
      [margin + step, margin + step],
      [margin + arm * 0.75, margin + step],
    ]),
    ...polyline([
      [margin + 2 * step, margin + arm * 0.5],
      [margin + 2 * step, margin + 2 * step],
      [margin + arm * 0.5, margin + 2 * step],
    ]),
  ];
  const squares = fourCorners(rectangle(margin + 3 * step, margin + 3 * step, 5, 5), width, height);
  const inset = margin + step * 1.5;
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(fourCorners(piece, width, height), NONE, line(colors.primary, 1.6)),
      shape(squares, solid(colors.secondary)),
      shape(rectangle(inset, inset, width - 2 * inset, height - 2 * inset), NONE, line(colors.primary, 0.5)),
    ],
  };
}

function starburst(cx: number, cy: number, outer: number, inner: number, points: number): Segment[] {
  const corners: Point[] = [];
  for (let index = 0; index < points * 2; index += 1) corners.push(polar(cx, cy, index % 2 ? inner : outer, (index * Math.PI) / points - Math.PI / 2));
  return polyline(corners, true);
}

function starSeal(colors: OrnamentColors): VectorArt {
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [
      shape(starburst(100, 100, 98, 87, 36), { type: "linear", angle: 135, stops: [{ offset: 0, color: lighter(colors.primary, 0.2) }, { offset: 1, color: darker(colors.primary, 0.2) }] }),
      shape(circle(100, 100, 74), NONE, line(colors.secondary, 1.6)),
      shape(circle(100, 100, 68), NONE, line(colors.secondary, 0.8, "dotted")),
    ],
  };
}

function ribbonSeal(colors: OrnamentColors): VectorArt {
  const tail: Point[] = [
    [74, 150],
    [104, 162],
    [92, 248],
    [76, 230],
    [56, 242],
  ];
  const left = polyline(tail, true);
  const rightTail = mirrored(left, 200, 0, true, false);
  const seal = starSeal(colors).paths;
  return {
    viewWidth: 200,
    viewHeight: 250,
    paths: [shape(left, solid(darker(colors.primary, 0.15))), shape(rightTail, solid(darker(colors.primary, 0.3))), ...seal],
  };
}

function scallopSeal(colors: OrnamentColors): VectorArt {
  const edge: Point[] = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * TAU;
    return polar(100, 100, 92 + 5 * Math.cos(24 * angle), angle);
  });
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [
      shape(smooth(edge, true), { type: "radial", stops: [{ offset: 0, color: lighter(colors.primary, 0.15) }, { offset: 1, color: darker(colors.primary, 0.1) }] }),
      shape(circle(100, 100, 76), NONE, line(colors.secondary, 1.5)),
      shape(circle(100, 100, 71), NONE, line(colors.secondary, 0.6)),
    ],
  };
}

function ribbonBanner(colors: OrnamentColors): VectorArt {
  const leftEnd = polyline(
    [
      [0, 24],
      [44, 24],
      [44, 76],
      [0, 76],
      [14, 50],
    ],
    true,
  );
  const leftFold = polyline(
    [
      [28, 62],
      [44, 62],
      [44, 76],
    ],
    true,
  );
  return {
    viewWidth: 340,
    viewHeight: 80,
    paths: [
      shape([...leftEnd, ...mirrored(leftEnd, 340, 0, true, false)], solid(darker(colors.primary, 0.18))),
      shape([...leftFold, ...mirrored(leftFold, 340, 0, true, false)], solid(darker(colors.primary, 0.45))),
      shape(rectangle(28, 8, 284, 54), { type: "linear", angle: 180, stops: [{ offset: 0, color: lighter(colors.primary, 0.12) }, { offset: 1, color: colors.primary }] }),
    ],
  };
}

function leaf(base: Point, angle: number, length: number): Segment[] {
  const width = length * 0.36;
  const local: Segment[] = [
    { op: "M", points: [[0, 0]] },
    { op: "C", points: [[length * 0.3, -width], [length * 0.75, -width * 0.8], [length, 0]] },
    { op: "C", points: [[length * 0.75, width * 0.8], [length * 0.3, width], [0, 0]] },
    { op: "Z", points: [] },
  ];
  return mapPoints(local, ([x, y]) => [base[0] + x * Math.cos(angle) - y * Math.sin(angle), base[1] + x * Math.sin(angle) + y * Math.cos(angle)]);
}

function laurel(colors: OrnamentColors): VectorArt {
  const cx = 110;
  const cy = 108;
  const radius = 84;
  const from = (100 * Math.PI) / 180;
  const to = (250 * Math.PI) / 180;
  const leaves: Segment[] = [];
  const count = 13;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const angle = from + (to - from) * t;
    const base = polar(cx, cy, radius, angle);
    const tangent = angle + Math.PI / 2;
    const length = 22 - 9 * Math.abs(t - 0.45);
    leaves.push(...leaf(base, tangent + 0.55, length), ...leaf(base, tangent - 0.55, length * 0.86));
  }
  const stem = arc(cx, cy, radius, from, to);
  const mirror = (segments: Segment[]) => mirrored(segments, 220, 0, true, false);
  return {
    viewWidth: 220,
    viewHeight: 210,
    paths: [shape([...stem, ...mirror(stem)], NONE, line(darker(colors.primary, 0.2), 1.6)), shape([...leaves, ...mirror(leaves)], solid(colors.primary))],
  };
}

function diamondDivider(colors: OrnamentColors): VectorArt {
  const diamond = (cx: number, r: number): Segment[] =>
    polyline(
      [
        [cx, 10 - r],
        [cx + r, 10],
        [cx, 10 + r],
        [cx - r, 10],
      ],
      true,
    );
  return {
    viewWidth: 300,
    viewHeight: 20,
    paths: [
      shape([...polyline([[0, 10], [128, 10]]), ...polyline([[172, 10], [300, 10]])], NONE, line(colors.primary, 1)),
      shape(diamond(150, 8), solid(colors.primary)),
      shape([...diamond(136, 3.5), ...diamond(164, 3.5)], solid(colors.secondary)),
    ],
  };
}

function flourishDivider(colors: OrnamentColors): VectorArt {
  const right: Point[] = [
    [150, 20],
    [166, 10],
    [186, 9],
    [198, 18],
    [194, 29],
    [182, 30],
    [178, 22],
    [186, 18],
  ];
  const tail: Point[] = [
    [190, 24],
    [230, 21],
    [270, 20],
    [298, 20],
  ];
  const half = [...smooth(right), ...smooth(tail)];
  return {
    viewWidth: 300,
    viewHeight: 40,
    paths: [shape([...half, ...mirrored(half, 300, 0, true, false)], NONE, line(colors.primary, 1.3)), shape(circle(150, 20, 3.4), solid(colors.secondary))],
  };
}

function dotsDivider(colors: OrnamentColors): VectorArt {
  const dots: Segment[] = [];
  const sizes = [5, 3.6, 2.6, 1.8, 1.2];
  sizes.forEach((r, index) => {
    const gap = 16 * index;
    dots.push(...circle(150 + gap, 10, r));
    if (index) dots.push(...circle(150 - gap, 10, r));
  });
  return { viewWidth: 300, viewHeight: 20, paths: [shape(dots, solid(colors.primary))] };
}

function cornerTriangles(colors: OrnamentColors): VectorArt {
  const triangle = (size: number) =>
    polyline(
      [
        [0, 0],
        [size, 0],
        [0, size],
      ],
      true,
    );
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [
      shape(triangle(200), solid(lighter(colors.primary, 0.7))),
      shape(triangle(150), { type: "linear", angle: 135, stops: [{ offset: 0, color: colors.primary }, { offset: 1, color: lighter(colors.primary, 0.3) }] }),
      shape(triangle(78), solid(colors.secondary)),
    ],
  };
}

function waves(colors: OrnamentColors): VectorArt {
  const band = (base: number, amplitude: number, length: number, phase: number): Segment[] => {
    const points: Point[] = Array.from({ length: 49 }, (_, index) => {
      const x = (index / 48) * 600;
      return [x, base + amplitude * Math.sin((x / length) * TAU + phase)];
    });
    return [...smooth(points), { op: "L", points: [[600, 140]] }, { op: "L", points: [[0, 140]] }, { op: "Z", points: [] }];
  };
  return {
    viewWidth: 600,
    viewHeight: 140,
    paths: [
      shape(band(40, 14, 320, 0.4), solid(lighter(colors.primary, 0.6))),
      shape(band(66, 16, 260, 2.1), solid(lighter(colors.primary, 0.25))),
      shape(band(96, 12, 380, 4), { type: "linear", angle: 90, stops: [{ offset: 0, color: colors.primary }, { offset: 1, color: darker(colors.primary, 0.25) }] }),
    ],
  };
}

function confetti(colors: OrnamentColors): VectorArt {
  const random = seeded(7);
  const first: Segment[] = [];
  const second: Segment[] = [];
  for (let index = 0; index < 42; index += 1) {
    const x = 6 + random() * 288;
    const y = 6 + random() * 188;
    const target = index % 2 ? first : second;
    const kind = index % 3;
    if (kind === 0) target.push(...circle(x, y, 1.8 + random() * 2.4));
    else if (kind === 1) target.push(...mapPoints(rectangle(x - 5, y - 1.6, 10, 3.2), rotateAround([x, y], random() * Math.PI)));
    else
      target.push(
        ...mapPoints(
          polyline(
            [
              [x, y - 4],
              [x + 4, y + 3],
              [x - 4, y + 3],
            ],
            true,
          ),
          rotateAround([x, y], random() * Math.PI),
        ),
      );
  }
  return { viewWidth: 300, viewHeight: 200, paths: [shape(first, solid(colors.primary)), shape(second, solid(colors.secondary))] };
}

function blob(colors: OrnamentColors): VectorArt {
  const random = seeded(3);
  const points: Point[] = Array.from({ length: 9 }, (_, index) => polar(100, 100, 70 + random() * 26, (index / 9) * TAU));
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [shape(smooth(points, true), { type: "linear", angle: 45, stops: [{ offset: 0, color: colors.primary }, { offset: 1, color: colors.secondary }] })],
  };
}

function arcRings(colors: OrnamentColors): VectorArt {
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [
      shape(arc(100, 100, 92, Math.PI * 0.75, Math.PI * 2.0), NONE, line(colors.primary, 7)),
      shape(arc(100, 100, 72, Math.PI * 1.1, Math.PI * 2.4), NONE, line(colors.secondary, 4)),
      shape(arc(100, 100, 55, Math.PI * 0.4, Math.PI * 1.6), NONE, line(colors.primary, 2)),
    ],
  };
}

function shield(colors: OrnamentColors): VectorArt {
  const outline = (inset: number): Segment[] => [
    { op: "M", points: [[10 + inset, 12 + inset]] },
    { op: "L", points: [[150 - inset, 12 + inset]] },
    { op: "L", points: [[150 - inset, 92]] },
    { op: "C", points: [[150 - inset, 146 - inset * 0.5], [100, 176 - inset], [80, 190 - inset * 1.4]] },
    { op: "C", points: [[60, 176 - inset], [10 + inset, 146 - inset * 0.5], [10 + inset, 92]] },
    { op: "Z", points: [] },
  ];
  return {
    viewWidth: 160,
    viewHeight: 200,
    paths: [shape(outline(0), { type: "linear", angle: 180, stops: [{ offset: 0, color: lighter(colors.primary, 0.1) }, { offset: 1, color: darker(colors.primary, 0.2) }] }), shape(outline(9), NONE, line(colors.secondary, 1.4))],
  };
}

const PAGE = { width: 842, height: 595 };

export const ORNAMENTS: Ornament[] = [
  { id: "guillocheFrame", category: "frames", fitsPage: true, size: PAGE, build: guillocheFrame },
  { id: "doubleFrame", category: "frames", fitsPage: true, size: PAGE, build: doubleFrame },
  { id: "ornateFrame", category: "frames", fitsPage: true, size: PAGE, build: ornateFrame },
  { id: "decoFrame", category: "frames", fitsPage: true, size: PAGE, build: decoFrame },
  { id: "guillocheRosette", category: "seals", fitsPage: false, size: { width: 200, height: 200 }, build: guillocheRosette },
  { id: "starSeal", category: "seals", fitsPage: false, size: { width: 200, height: 200 }, build: starSeal },
  { id: "ribbonSeal", category: "seals", fitsPage: false, size: { width: 200, height: 250 }, build: ribbonSeal },
  { id: "scallopSeal", category: "seals", fitsPage: false, size: { width: 200, height: 200 }, build: scallopSeal },
  { id: "laurel", category: "seals", fitsPage: false, size: { width: 220, height: 210 }, build: laurel },
  { id: "shield", category: "seals", fitsPage: false, size: { width: 160, height: 200 }, build: shield },
  { id: "ribbonBanner", category: "dividers", fitsPage: false, size: { width: 340, height: 80 }, build: ribbonBanner },
  { id: "diamondDivider", category: "dividers", fitsPage: false, size: { width: 300, height: 20 }, build: diamondDivider },
  { id: "flourishDivider", category: "dividers", fitsPage: false, size: { width: 300, height: 40 }, build: flourishDivider },
  { id: "dotsDivider", category: "dividers", fitsPage: false, size: { width: 300, height: 20 }, build: dotsDivider },
  { id: "cornerTriangles", category: "accents", fitsPage: false, size: { width: 200, height: 200 }, build: cornerTriangles },
  { id: "waves", category: "accents", fitsPage: false, size: { width: 600, height: 140 }, build: waves },
  { id: "confetti", category: "accents", fitsPage: false, size: { width: 300, height: 200 }, build: confetti },
  { id: "blob", category: "accents", fitsPage: false, size: { width: 200, height: 200 }, build: blob },
  { id: "arcRings", category: "accents", fitsPage: false, size: { width: 200, height: 200 }, build: arcRings },
  ...PREMIUM_ORNAMENTS,
];

export function ornament(id: string): Ornament | undefined {
  return ORNAMENTS.find((item) => item.id === id);
}
