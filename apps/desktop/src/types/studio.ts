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
  embed?: StudioEmbed | null;
  output?: string;
  overwrite?: boolean;
  dataPath?: string | null;
  sheet?: string | null;
  split?: boolean;
  outputDir?: string | null;
  pattern?: string;
  sign?: StudioSignOptions | null;
};

export type StudioSignOptions = { certificatePath: string; certificatePassword: string; reason?: string; location?: string };

export type StudioEmbed = { design: StudioDesign; assets: string[] };

export type StudioExportFormat = "pdf" | "png" | "jpg";

export type StudioRenderResult = { output: string; outputs: string[]; pageCount: number; bytes: number; missingGlyphs: string };

export type StudioImageInfo = { width: number; height: number; mime: string; base64: string };

export type StudioQrModules = { size: number; modules: string };

export type StudioImportedSvg = { svg: string; width: number; height: number };

export type StudioProjectSaveParams = { design: StudioDesign; assets: string[]; preview?: StudioRenderPage | null; language?: string; output: string; overwrite?: boolean };

export type StudioProjectSaveResult = { output: string; bytes: number; thumbnail: string };

export type StudioProjectOpenResult = { design: unknown; thumbnail: string; source: "project" | "pdf" };

export const STUDIO_PROJECT_EXTENSION = "vivedesign";

export const STUDIO_DOCUMENT_EXTENSION = "vivedoc";
export const STUDIO_DOCUMENT_VERSION = 1;

export type DocumentPaper = "a4" | "a5" | "b5" | "letter" | "legal";
export type DocumentPageNumbers = "none" | "center" | "right" | "outside";
export type DocumentAlign = "left" | "center" | "right";
export type DocumentCoverStyle = "classic" | "band" | "frame" | "minimal";

export type DocumentLayout = {
  paper: DocumentPaper;
  landscape: boolean;
  marginMm: number;
  fontSize: number;
  lineHeight: number;
  accent: string;
  header: string;
  headerAlign: DocumentAlign;
  footer: string;
  footerAlign: DocumentAlign;
  pageNumbers: DocumentPageNumbers;
  pageNumberFormat: string;
  furnitureOnFirst: boolean;
  toc: boolean;
  tocTitle: string;
  tocDepth: 1 | 2 | 3;
  cover: boolean;
  coverStyle: DocumentCoverStyle;
  title: string;
  subtitle: string;
  author: string;
  date: string;
};

export type DocumentSettings = DocumentLayout & { fontId: string; headingFontId: string | null };

export type DocumentNode = { type: string; attrs?: Record<string, unknown>; content?: DocumentNode[]; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string };

export type StudioDocument = { version: number; kind: "document"; name: string; settings: DocumentSettings; content: DocumentNode | string };

export type StudioDocumentContent = { html: string; images: string[]; fonts: string[]; settings: DocumentLayout; title: string; language: string };

export type StudioDocumentPreview = { token: string; pageCount: number; width: number; height: number };

export type StudioDocumentPage = { image: string; width: number; height: number };
