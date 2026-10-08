import type { StudioFill, StudioVectorPath } from "@/types/studio";
import { arc, circle, perimeter, polar, polyline, roundedRectangleAt, sampled, seeded, smooth, type Point, type Segment } from "./geometry";
import type { Ornament } from "./ornaments";
import { darker, fourCorners, lighter, line, mirrored, NONE, rectangle, shape, solid, TAU, type OrnamentColors, type VectorArt } from "./paint";

type Size = { width: number; height: number };

const PAGE: Size = { width: 842, height: 595 };

const linearFill = (angle: number, from: string, to: string): StudioFill => ({
  type: "linear",
  angle,
  stops: [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ],
});
const radialFill = (inner: string, outer: string): StudioFill => ({
  type: "radial",
  stops: [
    { offset: 0, color: inner },
    { offset: 1, color: outer },
  ],
});

function inside([x, y]: Point, { width, height }: Size): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function clamp([x, y]: Point, { width, height }: Size): Point {
  return [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
}

function clippedRuns(points: Point[], size: Size): Segment[] {
  const segments: Segment[] = [];
  let drawing = false;
  for (const point of points) {
    if (!inside(point, size)) {
      drawing = false;
      continue;
    }
    segments.push({ op: drawing ? "L" : "M", points: [point] });
    drawing = true;
  }
  return segments;
}

function leaf(base: Point, angle: number, length: number, width: number): Segment[] {
  const axis: Point = [Math.cos(angle), Math.sin(angle)];
  const normal: Point = [-axis[1], axis[0]];
  const at = (along: number, across: number): Point => [base[0] + axis[0] * along + normal[0] * across, base[1] + axis[1] * along + normal[1] * across];
  return [
    { op: "M", points: [base] },
    {
      op: "C",
      points: [at(length * 0.3, width), at(length * 0.72, width * 0.8), at(length, 0)],
    },
    {
      op: "C",
      points: [at(length * 0.72, -width * 0.8), at(length * 0.3, -width), base],
    },
    { op: "Z", points: [] },
  ];
}

function halftone(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const step = Math.max(Math.min(width, height) / 34, Math.sqrt((width * height) / 1100));
  const main: Segment[] = [];
  const echo: Segment[] = [];
  const far = Math.hypot(width, height);
  for (let row = 0; step / 2 + row * step * 0.866 <= height - step / 2; row += 1) {
    const y = step / 2 + row * step * 0.866;
    for (let x = step / 2 + (row % 2 ? step / 2 : 0); x <= width - step / 2; x += step) {
      const big = step * 0.46 * (1 - Math.hypot(width - x, height - y) / (far * 0.72));
      if (big > step * 0.05) main.push(...circle(x, y, big));
      const small = step * 0.36 * (1 - Math.hypot(x, y) / (far * 0.32));
      if (small > step * 0.05) echo.push(...circle(x, y, small));
    }
  }
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [shape(main, solid(colors.primary), null, { opacity: 0.18 }), shape(echo, solid(colors.secondary), null, { opacity: 0.24 })],
  };
}

function diagonalHatch(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const step = Math.min(width, height) / 42;
  const fine: Segment[] = [];
  const bold: Segment[] = [];
  let index = 0;
  for (let c = -height + step; c < width; c += step) {
    const from = Math.max(0, c);
    const to = Math.min(width, c + height);
    if (to - from > 0.5) {
      const target = index % 6 === 0 ? bold : fine;
      target.push({ op: "M", points: [[from, from - c]] }, { op: "L", points: [[to, to - c]] });
    }
    index += 1;
  }
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [shape(fine, NONE, line(colors.primary, 0.5), { opacity: 0.28 }), shape(bold, NONE, line(colors.secondary, 1.2), { opacity: 0.4 })],
  };
}

function topographic(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const short = Math.min(width, height);
  const fine: Segment[] = [];
  const index: Segment[] = [];
  const centres: Point[] = [
    [width * 0.86, height * 0.22],
    [width * 0.1, height * 0.92],
  ];
  centres.forEach(([cx, cy], centre) => {
    for (let ring = 1; ring <= 12; ring += 1) {
      const base = short * 0.06 * ring;
      const points = Array.from({ length: 241 }, (_, step) => {
        const angle = (step / 240) * TAU;
        const radius = base * (1 + 0.1 * Math.sin(3 * angle + ring * 0.5 + centre) + 0.05 * Math.sin(7 * angle - ring * 0.3));
        return polar(cx, cy, radius, angle);
      });
      (ring % 4 === 0 ? index : fine).push(...clippedRuns(points, size));
    }
  });
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [shape(fine, NONE, line(colors.primary, 0.6), { opacity: 0.32 }), shape(index, NONE, line(colors.secondary, 1), { opacity: 0.5 })],
  };
}

function triangleTiles(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const side = Math.min(width, height) / 5;
  const rise = side * 0.866;
  const random = seeded(11);
  const tones = [lighter(colors.primary, 0.9), lighter(colors.primary, 0.82), lighter(colors.primary, 0.74), lighter(colors.secondary, 0.78)];
  const groups: Segment[][] = tones.map(() => []);
  for (let row = 0; row * rise < height; row += 1) {
    const top = row * rise;
    const bottom = top + rise;
    for (let column = -2; column * (side / 2) - side < width; column += 1) {
      const left = column * (side / 2) - (row % 2 ? side / 2 : 0);
      const up = (column + row) % 2 === 0;
      const corners: Point[] = up
        ? [
            [left, bottom],
            [left + side / 2, top],
            [left + side, bottom],
          ]
        : [
            [left, top],
            [left + side, top],
            [left + side / 2, bottom],
          ];
      const clamped = corners.map((point) => clamp(point, size));
      const [a, b, c] = clamped;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      if (area < 1) continue;
      groups[Math.floor(random() * tones.length)].push(...polyline(clamped, true));
    }
  }
  return {
    viewWidth: width,
    viewHeight: height,
    paths: groups.map((segments, index) => shape(segments, solid(tones[index]))),
  };
}

function honeycomb(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const radius = Math.min(width, height) / 14;
  const rows = Math.sqrt(3) * radius;
  const bands: Segment[][] = [[], [], []];
  for (let column = 0; column * radius * 1.5 <= width + radius; column += 1) {
    const cx = column * radius * 1.5;
    for (let row = -1; row * rows <= height + rows; row += 1) {
      const cy = row * rows + (column % 2 ? rows / 2 : 0);
      const reach = cx / width;
      if (reach < 0.35) continue;
      const band = reach > 0.75 ? 0 : reach > 0.55 ? 1 : 2;
      const points = Array.from({ length: 7 }, (_, corner) => polar(cx, cy, radius * 0.94, (corner / 6) * TAU));
      bands[band].push(...clippedRuns(points, size));
    }
  }
  const opacities = [0.42, 0.26, 0.12];
  return {
    viewWidth: width,
    viewHeight: height,
    paths: bands.map((segments, index) => shape(segments, NONE, line(index === 0 ? colors.secondary : colors.primary, 0.9), { opacity: opacities[index] })),
  };
}

function marble(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const paths: StudioVectorPath[] = [];
  const wide = height * 0.05;
  const narrow = height * 0.025;
  for (let vein = 0; vein < 9; vein += 1) {
    const base = height * (0.1 + vein * 0.1);
    const points: Point[] = Array.from({ length: 61 }, (_, step) => {
      const x = (step / 60) * width;
      const y = base + wide * Math.sin((x / width) * TAU * 0.9 + vein * 0.7) + narrow * Math.sin((x / width) * TAU * 2.3 + vein * 1.9);
      return clamp([x, y], size);
    });
    const kind = vein % 3;
    paths.push(shape(smooth(points), NONE, line(kind === 0 ? colors.secondary : lighter(colors.primary, 0.45), kind === 0 ? 2.2 : kind === 1 ? 0.9 : 0.45), { opacity: 0.55 }));
  }
  return { viewWidth: width, viewHeight: height, paths };
}

function edgePoint(cx: number, cy: number, angle: number, { width, height }: Size): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let reach = Number.POSITIVE_INFINITY;
  if (dx > 1e-9) reach = Math.min(reach, (width - cx) / dx);
  if (dx < -1e-9) reach = Math.min(reach, -cx / dx);
  if (dy > 1e-9) reach = Math.min(reach, (height - cy) / dy);
  if (dy < -1e-9) reach = Math.min(reach, -cy / dy);
  return [cx + dx * reach, cy + dy * reach];
}

function sunburst(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const cx = width / 2;
  const cy = height * 0.62;
  const count = 32;
  const turn = (angle: number) => ((angle % TAU) + TAU) % TAU;
  const corners: Point[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const rays: Segment[] = [];
  for (let ray = 0; ray < count; ray += 2) {
    const from = (ray / count) * TAU;
    const span = TAU / count;
    const inner = corners
      .map((corner) => ({
        corner,
        offset: turn(Math.atan2(corner[1] - cy, corner[0] - cx) - from),
      }))
      .filter((entry) => entry.offset > 0 && entry.offset < span)
      .sort((a, b) => a.offset - b.offset)
      .map((entry) => entry.corner);
    rays.push(...polyline([[cx, cy], edgePoint(cx, cy, from, size), ...inner, edgePoint(cx, cy, from + span, size)], true));
  }
  const glow = Math.min(width, height) * 0.16;
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(rays, solid(lighter(colors.primary, 0.78)), null, {
        opacity: 0.55,
      }),
      shape(circle(cx, cy, glow), radialFill(lighter(colors.secondary, 0.35), lighter(colors.secondary, 0.85)), null, { opacity: 0.7 }),
    ],
  };
}

function decoFan(colors: OrnamentColors): VectorArt {
  const cx = 120;
  const cy = 124;
  const half = (radius: number): Segment[] => [...arc(cx, cy, radius, Math.PI, TAU), { op: "L", points: [[cx, cy]] }, { op: "Z", points: [] }];
  const rays: Segment[] = [];
  for (let index = 1; index < 10; index += 1) {
    const angle = Math.PI + (index / 10) * Math.PI;
    rays.push({ op: "M", points: [polar(cx, cy, 40, angle)] }, { op: "L", points: [polar(cx, cy, 114, angle)] });
  }
  return {
    viewWidth: 240,
    viewHeight: 130,
    paths: [
      shape(half(116), linearFill(90, lighter(colors.secondary, 0.25), darker(colors.secondary, 0.12))),
      shape([...arc(cx, cy, 96, Math.PI, TAU), ...arc(cx, cy, 76, Math.PI, TAU), ...arc(cx, cy, 116, Math.PI, TAU)], NONE, line(colors.primary, 1.2)),
      shape(rays, NONE, line(colors.primary, 0.9)),
      shape(half(36), solid(colors.primary)),
      shape(half(24), NONE, line(lighter(colors.secondary, 0.4), 1)),
    ],
  };
}

function botanicalSprig(colors: OrnamentColors): VectorArt {
  const stem: Point[] = [
    [60, 234],
    [56, 180],
    [63, 122],
    [57, 64],
    [61, 34],
  ];
  const along = (t: number): Point => {
    const scaled = t * (stem.length - 1);
    const index = Math.min(stem.length - 2, Math.floor(scaled));
    const local = scaled - index;
    return [stem[index][0] + (stem[index + 1][0] - stem[index][0]) * local, stem[index][1] + (stem[index + 1][1] - stem[index][1]) * local];
  };
  const leaves: Segment[] = [];
  const veins: Segment[] = [];
  for (let index = 0; index < 7; index += 1) {
    const t = 0.16 + index * 0.115;
    const side = index % 2 ? 1 : -1;
    const length = 44 - index * 3.2;
    const angle = -Math.PI / 2 + side * (Math.PI / 4.2);
    const base = along(t);
    leaves.push(...leaf(base, angle, length, length * 0.3));
    veins.push(
      { op: "M", points: [base] },
      {
        op: "L",
        points: [[base[0] + Math.cos(angle) * length * 0.85, base[1] + Math.sin(angle) * length * 0.85]],
      },
    );
  }
  leaves.push(...leaf(along(0.97), -Math.PI / 2, 20, 7));
  return {
    viewWidth: 120,
    viewHeight: 240,
    paths: [shape(smooth(stem), NONE, line(darker(colors.primary, 0.1), 2)), shape(leaves, linearFill(135, lighter(colors.primary, 0.3), colors.primary)), shape(veins, NONE, line(lighter(colors.primary, 0.55), 0.6))],
  };
}

function brushStroke(colors: OrnamentColors): VectorArt {
  const random = seeded(23);
  const count = 48;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let index = 0; index <= count; index += 1) {
    const u = index / count;
    const x = 8 + u * 384;
    const body = Math.pow(Math.sin(Math.PI * u), 0.35);
    const centre = 45 + Math.sin(u * Math.PI * 1.4) * 4;
    top.push([x, centre - (26 * body + (random() - 0.5) * 5 * body)]);
    bottom.push([x, centre + (26 * body + (random() - 0.5) * 5 * body)]);
  }
  const streaks: Segment[] = [];
  for (let index = 0; index < 5; index += 1) {
    const y = 30 + index * 7.5 + random() * 2;
    const from = 40 + random() * 60;
    const to = 300 + random() * 70;
    streaks.push({ op: "M", points: [[from, y]] }, { op: "L", points: [[to, y + (random() - 0.5) * 3]] });
  }
  return {
    viewWidth: 400,
    viewHeight: 90,
    paths: [
      shape(polyline([...top, ...bottom.reverse()], true), solid(colors.secondary)),
      shape(streaks, NONE, line(darker(colors.secondary, 0.18), 1.4), {
        opacity: 0.35,
      }),
    ],
  };
}

function paperCurl(colors: OrnamentColors): VectorArt {
  const revealed = polyline(
    [
      [160, 62],
      [160, 160],
      [62, 160],
    ],
    true,
  );
  const flap: Segment[] = [
    { op: "M", points: [[160, 62]] },
    {
      op: "C",
      points: [
        [138, 84],
        [120, 96],
        [100, 100],
      ],
    },
    {
      op: "C",
      points: [
        [96, 120],
        [84, 138],
        [62, 160],
      ],
    },
    {
      op: "C",
      points: [
        [96, 140],
        [140, 96],
        [160, 62],
      ],
    },
    { op: "Z", points: [] },
  ];
  const shadow: Segment[] = [
    { op: "M", points: [[160, 70]] },
    {
      op: "C",
      points: [
        [132, 98],
        [112, 112],
        [104, 106],
      ],
    },
    {
      op: "C",
      points: [
        [112, 112],
        [98, 132],
        [70, 160],
      ],
    },
    { op: "L", points: [[160, 160]] },
    { op: "Z", points: [] },
  ];
  return {
    viewWidth: 160,
    viewHeight: 160,
    paths: [shape(revealed, solid(colors.primary)), shape(shadow, solid(darker(colors.primary, 0.5)), null, { opacity: 0.3 }), shape(flap, linearFill(135, lighter(colors.primary, 0.92), lighter(colors.primary, 0.6)))],
  };
}

function ribbonCorner(colors: OrnamentColors): VectorArt {
  const band = polyline(
    [
      [86, 0],
      [140, 0],
      [0, 140],
      [0, 86],
    ],
    true,
  );
  const stitches: Segment[] = [
    { op: "M", points: [[93, 0]] },
    { op: "L", points: [[0, 93]] },
    { op: "M", points: [[133, 0]] },
    { op: "L", points: [[0, 133]] },
  ];
  const folds = [
    ...polyline(
      [
        [140, 0],
        [154, 0],
        [140, 12],
      ],
      true,
    ),
    ...polyline(
      [
        [0, 140],
        [0, 154],
        [12, 140],
      ],
      true,
    ),
  ];
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [shape(folds, solid(darker(colors.secondary, 0.4))), shape(band, linearFill(45, lighter(colors.secondary, 0.2), darker(colors.secondary, 0.15))), shape(stitches, NONE, line(lighter(colors.secondary, 0.55), 0.9, "dashed"))],
  };
}

function waxSeal(colors: OrnamentColors): VectorArt {
  const random = seeded(5);
  const edge = Array.from({ length: 26 }, (_, index) => polar(100, 100, 84 + random() * 9, (index / 26) * TAU));
  const star: Point[] = Array.from({ length: 16 }, (_, index) => polar(100, 100, index % 2 ? 11 : 27, (index / 16) * TAU - Math.PI / 2));
  return {
    viewWidth: 200,
    viewHeight: 200,
    paths: [
      shape(smooth(edge, true), radialFill(lighter(colors.primary, 0.18), darker(colors.primary, 0.3))),
      shape(circle(100, 100, 62), NONE, line(darker(colors.primary, 0.4), 3)),
      shape(circle(100, 100, 57), radialFill(lighter(colors.primary, 0.12), darker(colors.primary, 0.15))),
      shape(polyline(star, true), solid(darker(colors.primary, 0.35))),
      shape(arc(100, 100, 73, Math.PI * 1.08, Math.PI * 1.46), NONE, line(lighter(colors.primary, 0.55), 3), { opacity: 0.6 }),
    ],
  };
}

function nouveauFrame(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const short = Math.min(width, height);
  const margin = short * 0.045;
  const reach = short * 0.17;
  const whip = smooth([
    [margin + 2, margin + reach],
    [margin + reach * 0.1, margin + reach * 0.5],
    [margin + reach * 0.3, margin + reach * 0.3],
    [margin + reach * 0.5, margin + reach * 0.1],
    [margin + reach, margin + 2],
  ]);
  const centre: Point = [margin + reach * 0.26, margin + reach * 0.26];
  const spiral = sampled(
    80,
    (t) => {
      const radius = reach * 0.16 * (1 - t * 0.85);
      return polar(centre[0], centre[1], radius, Math.PI * 1.25 + t * TAU * 1.6);
    },
    false,
  );
  const leaves = [...leaf([margin + reach, margin + 2], 0.3, reach * 0.22, reach * 0.06), ...leaf([margin + 2, margin + reach], Math.PI / 2 - 0.3, reach * 0.22, reach * 0.06)];
  const arch: Segment[] = [...arc(width / 2, margin, reach * 0.34, 0, Math.PI)];
  const gem = circle(width / 2, margin + reach * 0.34, 2.6);
  const outer = rectangle(margin, margin, width - 2 * margin, height - 2 * margin);
  const inner = rectangle(margin + 7, margin + 7, width - 2 * (margin + 7), height - 2 * (margin + 7));
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(outer, NONE, line(colors.primary, 0.9)),
      shape(inner, NONE, line(colors.primary, 0.4)),
      shape(fourCorners([...whip, ...spiral], width, height), NONE, line(colors.secondary, 1.4)),
      shape(fourCorners(leaves, width, height), solid(colors.secondary)),
      shape([...arch, ...mirrored(arch, width, height, false, true)], NONE, line(colors.secondary, 1)),
      shape([...gem, ...mirrored(gem, width, height, false, true)], solid(colors.primary)),
    ],
  };
}

function gemFrame(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const margin = Math.min(width, height) * 0.04;
  const gap = 6;
  const corner = margin + gap / 2;
  const radius = Math.min(9, corner);
  const facet = (a: Point, b: Point) =>
    fourCorners(
      polyline(
        [
          [corner, corner],
          [corner + a[0] * radius, corner + a[1] * radius],
          [corner + b[0] * radius, corner + b[1] * radius],
        ],
        true,
      ),
      width,
      height,
    );
  const dots = [...circle(width / 2, corner, 2.2), ...circle(width / 2, height - corner, 2.2), ...circle(corner, height / 2, 2.2), ...circle(width - corner, height / 2, 2.2)];
  return {
    viewWidth: width,
    viewHeight: height,
    paths: [
      shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), NONE, line(colors.primary, 0.7)),
      shape(rectangle(margin + gap, margin + gap, width - 2 * (margin + gap), height - 2 * (margin + gap)), NONE, line(colors.primary, 0.35)),
      shape(facet([0, -1], [1, 0]), solid(lighter(colors.secondary, 0.45))),
      shape(facet([1, 0], [0, 1]), solid(colors.secondary)),
      shape(facet([0, 1], [-1, 0]), solid(darker(colors.secondary, 0.28))),
      shape(facet([-1, 0], [0, -1]), solid(lighter(colors.secondary, 0.18))),
      shape(dots, solid(colors.secondary)),
    ],
  };
}

function guillocheBorder(colors: OrnamentColors, size: Size): VectorArt {
  const { width, height } = size;
  const short = Math.min(width, height);
  const margin = short * 0.05;
  const band = short * 0.05;
  const middle = {
    x: margin + band / 2,
    y: margin + band / 2,
    width: width - 2 * margin - band,
    height: height - 2 * margin - band,
  };
  const along = roundedRectangleAt(middle.x, middle.y, middle.width, middle.height, band * 0.6);
  const length = perimeter(middle.width, middle.height, band * 0.6);
  const waves = Math.min(700, Math.max(12, Math.round(length / (band * 0.7))));
  const paths: StudioVectorPath[] = [];
  for (let layer = 0; layer < 6; layer += 1) {
    const shift = (TAU * layer) / 6;
    const depth = layer % 2 ? 0.62 : 0.9;
    const curve = sampled(Math.min(waves * 16, 7000), (t) => {
      const { point, normal } = along(t);
      const offset = (band / 2) * depth * Math.sin(waves * TAU * t + shift);
      return [point[0] + normal[0] * offset, point[1] + normal[1] * offset];
    });
    paths.push(shape(curve, NONE, line(layer % 2 ? colors.secondary : colors.primary, 0.42)));
  }
  const rosetteCentre = margin + band / 2;
  const rosette: Segment[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    rosette.push(...sampled(160, (t) => polar(rosetteCentre, rosetteCentre, band * (0.62 + 0.18 * Math.cos(10 * (t * TAU) + layer)), t * TAU)));
  }
  paths.push(
    shape(rectangle(margin, margin, width - 2 * margin, height - 2 * margin), NONE, line(colors.primary, 1.3)),
    shape(rectangle(margin + band, margin + band, width - 2 * (margin + band), height - 2 * (margin + band)), NONE, line(colors.primary, 0.8)),
    shape(fourCorners([...circle(rosetteCentre, rosetteCentre, band * 0.86)], width, height), solid(lighter(colors.secondary, 0.82))),
    shape(fourCorners(rosette, width, height), NONE, line(colors.secondary, 0.5)),
  );
  return { viewWidth: width, viewHeight: height, paths };
}

export const PREMIUM_ORNAMENTS: Ornament[] = [
  {
    id: "nouveauFrame",
    category: "frames",
    fitsPage: true,
    size: PAGE,
    build: nouveauFrame,
  },
  {
    id: "gemFrame",
    category: "frames",
    fitsPage: true,
    size: PAGE,
    build: gemFrame,
  },
  {
    id: "guillocheBorder",
    category: "frames",
    fitsPage: true,
    size: PAGE,
    build: guillocheBorder,
  },
  {
    id: "waxSeal",
    category: "seals",
    fitsPage: false,
    size: { width: 200, height: 200 },
    build: waxSeal,
  },
  {
    id: "decoFan",
    category: "accents",
    fitsPage: false,
    size: { width: 240, height: 130 },
    build: decoFan,
  },
  {
    id: "botanicalSprig",
    category: "accents",
    fitsPage: false,
    size: { width: 120, height: 240 },
    build: botanicalSprig,
  },
  {
    id: "brushStroke",
    category: "accents",
    fitsPage: false,
    size: { width: 400, height: 90 },
    build: brushStroke,
  },
  {
    id: "paperCurl",
    category: "accents",
    fitsPage: false,
    size: { width: 160, height: 160 },
    build: paperCurl,
  },
  {
    id: "ribbonCorner",
    category: "accents",
    fitsPage: false,
    size: { width: 200, height: 200 },
    build: ribbonCorner,
  },
  {
    id: "halftone",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: halftone,
  },
  {
    id: "diagonalHatch",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: diagonalHatch,
  },
  {
    id: "topographic",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: topographic,
  },
  {
    id: "triangleTiles",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: triangleTiles,
  },
  {
    id: "honeycomb",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: honeycomb,
  },
  {
    id: "marble",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: marble,
  },
  {
    id: "sunburst",
    category: "patterns",
    fitsPage: true,
    size: PAGE,
    build: sunburst,
  },
];
