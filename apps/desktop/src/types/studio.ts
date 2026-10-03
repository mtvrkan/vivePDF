export const STUDIO_DESIGN_VERSION = 1;

export type StudioGradientStop = { offset: number; color: string };

export type StudioFill =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "linear"; angle: number; stops: StudioGradientStop[] }
  | { type: "radial"; stops: StudioGradientStop[] };

export type StudioDash = "solid" | "dashed" | "dotted";

export type StudioStroke = { color: string; width: number; dash: StudioDash };

export type StudioElementBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  groupId: string | null;
};

export type StudioTextRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };

export type StudioTextAlign = "left" | "center" | "right" | "justify";

export type StudioVerticalAlign = "top" | "middle" | "bottom";

export type StudioTextElement = StudioElementBase & {
  kind: "text";
  runs: StudioTextRun[];
  fontId: string | null;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: StudioTextAlign;
  verticalAlign: StudioVerticalAlign;
  lineHeight: number;
  letterSpacing: number;
  uppercase: boolean;
  shrinkToFit: boolean;
};

export const STUDIO_SHAPES = [
  "rect",
  "ellipse",
  "triangle",
  "rightTriangle",
  "diamond",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "burst",
  "heart",
  "arrow",
  "chevron",
  "parallelogram",
  "trapezoid",
  "cross",
  "speech",
  "line",
  "arrowLine",
] as const;

export type StudioShapeKind = (typeof STUDIO_SHAPES)[number];

export type StudioShapeElement = StudioElementBase & {
  kind: "shape";
  shape: StudioShapeKind;
  fill: StudioFill;
  stroke: StudioStroke | null;
  cornerRadius: number;
  points: number;
  innerRatio: number;
};

export type StudioImageFit = "cover" | "contain" | "stretch";

export type StudioCrop = { x: number; y: number; width: number; height: number };

export type StudioImageMask = "none" | "rounded" | "circle";

export type StudioImageElement = StudioElementBase & {
  kind: "image";
  src: string;
  fit: StudioImageFit;
  crop: StudioCrop;
  mask: StudioImageMask;
  cornerRadius: number;
  stroke: StudioStroke | null;
};

export type StudioQrLevel = "L" | "M" | "Q" | "H";

export type StudioQrElement = StudioElementBase & {
  kind: "qr";
  value: string;
  color: string;
  background: string | null;
  errorLevel: StudioQrLevel;
};

export type StudioVectorPath = {
  d: string;
  fill: StudioFill;
  stroke: StudioStroke | null;
  evenOdd: boolean;
  opacity: number;
};

export type StudioVectorElement = StudioElementBase & {
  kind: "vector";
  viewWidth: number;
  viewHeight: number;
  paths: StudioVectorPath[];
};

export type StudioSvgSource = "table" | "chart" | "formula" | "flowchart" | "import";

export type StudioSvgElement = StudioElementBase & {
  kind: "svg";
  svg: string;
  source: StudioSvgSource;
  data: unknown;
};

export type StudioElement =
  | StudioTextElement
  | StudioShapeElement
  | StudioImageElement
  | StudioQrElement
  | StudioVectorElement
  | StudioSvgElement;

export type StudioElementKind = StudioElement["kind"];

export type StudioBackgroundImage = { src: string; fit: StudioImageFit; opacity: number };

export type StudioBackground = { fill: StudioFill; image: StudioBackgroundImage | null };

export type StudioPage = {
  id: string;
  width: number;
  height: number;
  background: StudioBackground;
  elements: StudioElement[];
};

export type StudioDesign = {
  version: number;
  kind: "design";
  name: string;
  palette: string[];
  pages: StudioPage[];
};

export type StudioRenderStop = { offset: number; color: string };

export type StudioRenderFill =
  | { type: "solid"; color: string }
  | { type: "linear"; x1: number; y1: number; x2: number; y2: number; stops: StudioRenderStop[] }
  | { type: "radial"; cx: number; cy: number; r: number; stops: StudioRenderStop[] };

export type StudioRenderStroke = {
  color: string;
  width: number;
  dash: number[];
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
};

export type StudioRenderPath = {
  d: string;
  fill: StudioRenderFill | null;
  stroke: StudioRenderStroke | null;
  evenOdd: boolean;
  opacity: number;
};

export type StudioRenderBox = { x: number; y: number; width: number; height: number; rotation: number; opacity: number };

export type StudioRenderSegment = {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  letterSpacing: number;
};

export type StudioRenderItem =
  | (StudioRenderBox & { kind: "vector"; paths: StudioRenderPath[]; viewWidth?: number; viewHeight?: number })
  | (StudioRenderBox & { kind: "svg"; svg: string })
  | (StudioRenderBox & { kind: "image"; path: string; fit: StudioImageFit; crop: StudioCrop | null; mask: StudioImageMask; radius: number })
  | (StudioRenderBox & { kind: "qr"; value: string; color: string; background: string | null; errorLevel: StudioQrLevel })
  | (StudioRenderBox & {
      kind: "text";
      runs: { text: string; bold: boolean; italic: boolean; underline: boolean; color: string }[];
      fontId: string | null;
      fontSize: number;
      align: StudioTextAlign;
      verticalAlign: StudioVerticalAlign;
      lineHeight: number;
      letterSpacing: number;
      uppercase: boolean;
      shrinkToFit: boolean;
      segments?: StudioRenderSegment[];
    });

export type StudioRenderPage = { width: number; height: number; items: StudioRenderItem[] };

export type StudioRenderParams = {
  pages: StudioRenderPage[];
  rows?: Record<string, string>[];
  date?: string;
  language?: string;
  title?: string;
  format?: StudioExportFormat;
  dpi?: number;
  output: string;
  overwrite?: boolean;
};

export type StudioExportFormat = "pdf" | "png" | "jpg";

export type StudioRenderResult = { output: string; outputs: string[]; pageCount: number; bytes: number; missingGlyphs: string };

export type StudioImageInfo = { width: number; height: number; mime: string; base64: string };

export type StudioQrModules = { size: number; modules: string };

export type StudioImportedSvg = { svg: string; width: number; height: number };
