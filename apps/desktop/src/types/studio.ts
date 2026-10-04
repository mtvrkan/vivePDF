export const STUDIO_DESIGN_VERSION = 1;

export type StudioGradientStop = { offset: number; color: string };

export type StudioFill =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "linear"; angle: number; stops: StudioGradientStop[] }
  | { type: "radial"; stops: StudioGradientStop[]; cx?: number; cy?: number; radius?: number };

export const STUDIO_DASHES = ["solid", "dashed", "dotted", "longDash", "dashDot"] as const;

export type StudioDash = (typeof STUDIO_DASHES)[number];

export const STUDIO_LINE_CAPS = ["butt", "round", "square"] as const;

export type StudioLineCap = (typeof STUDIO_LINE_CAPS)[number];

export const STUDIO_LINE_JOINS = ["miter", "round", "bevel"] as const;

export type StudioLineJoin = (typeof STUDIO_LINE_JOINS)[number];

export type StudioStroke = { color: string; width: number; dash: StudioDash; cap?: StudioLineCap; join?: StudioLineJoin; gap?: number };

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

export type StudioTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fontId?: string;
  scale?: number;
  weight?: number | null;
};

export const STUDIO_TEXT_CASES = ["none", "upper", "lower", "title"] as const;
export type StudioTextCase = (typeof STUDIO_TEXT_CASES)[number];

export const STUDIO_TEXT_AUTO_SIZES = ["fixed", "height", "width", "shrink"] as const;
export type StudioTextAutoSize = (typeof STUDIO_TEXT_AUTO_SIZES)[number];

export const STUDIO_LIST_KINDS = ["none", "bullet", "dash", "check", "decimal", "alpha", "roman"] as const;
export type StudioListKind = (typeof STUDIO_LIST_KINDS)[number];

export type StudioParagraph = { list: StudioListKind; level: number };

export type StudioTextOutline = { color: string; width: number };

export type StudioTextShadow = { color: string; x: number; y: number; opacity: number };

export type StudioTextHighlight = { color: string; padding: number };

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
  strike: boolean;
  weight: number | null;
  align: StudioTextAlign;
  verticalAlign: StudioVerticalAlign;
  lineHeight: number;
  letterSpacing: number;
  textCase: StudioTextCase;
  autoSize: StudioTextAutoSize;
  paragraphs: StudioParagraph[];
  outline: StudioTextOutline | null;
  shadow: StudioTextShadow | null;
  highlight: StudioTextHighlight | null;
  language: string | null;
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
  "cloud",
] as const;

export type StudioShapeKind = (typeof STUDIO_SHAPES)[number];

export type StudioDropShadow = { color: string; opacity: number; x: number; y: number; blur: number };

export type StudioShadowable = { dropShadow: StudioDropShadow | null };

export const STUDIO_ARROWHEADS = ["none", "arrow", "openArrow", "triangle", "circle", "square", "bar"] as const;

export type StudioArrowhead = (typeof STUDIO_ARROWHEADS)[number];

export type StudioCornerRadii = [number, number, number, number];

export type StudioShapeElement = StudioElementBase & StudioShadowable & {
  kind: "shape";
  shape: StudioShapeKind;
  fill: StudioFill;
  stroke: StudioStroke | null;
  cornerRadius: number;
  corners: StudioCornerRadii | null;
  points: number;
  innerRatio: number;
  startArrow: StudioArrowhead;
  endArrow: StudioArrowhead;
  arrowSize: number;
};

export type StudioImageFit = "cover" | "contain" | "stretch";

export type StudioCrop = { x: number; y: number; width: number; height: number };

export type StudioImageMask = "none" | "rounded" | "circle";

export type StudioImageElement = StudioElementBase & StudioShadowable & {
  kind: "image";
  src: string;
  fit: StudioImageFit;
  crop: StudioCrop;
  mask: StudioImageMask;
  cornerRadius: number;
  stroke: StudioStroke | null;
};

export type StudioQrLevel = "L" | "M" | "Q" | "H";

export type StudioQrElement = StudioElementBase & StudioShadowable & {
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

export type StudioVectorElement = StudioElementBase & StudioShadowable & {
  kind: "vector";
  viewWidth: number;
  viewHeight: number;
  paths: StudioVectorPath[];
};

export type StudioSvgSource = "table" | "chart" | "formula" | "flowchart" | "import";

export type StudioSvgElement = StudioElementBase & StudioShadowable & {
  kind: "svg";
  svg: string;
  source: StudioSvgSource;
  data: unknown;
  colorMap?: Record<string, string>;
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

export type StudioGuide = { axis: "x" | "y"; position: number };

export type StudioPage = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: StudioBackground;
  elements: StudioElement[];
  guides?: StudioGuide[];
};

export type StudioDesign = {
  version: number;
  kind: "design";
  name: string;
  palette: string[];
  pages: StudioPage[];
  margins?: number;
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
  cap: StudioLineCap;
  join: StudioLineJoin;
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
  strike: boolean;
  color: string;
  letterSpacing: number;
  fontId: string | null;
  weight: number;
};

export type StudioRenderRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  fontId: string | null;
  size: number;
  weight: number;
};

export type StudioRenderBand = { x: number; y: number; width: number; height: number };

export type StudioMeasuredText = { segments: StudioRenderSegment[]; bands: StudioRenderBand[] };

export type StudioRenderShape =
  | (StudioRenderBox & { kind: "vector"; paths: StudioRenderPath[]; viewWidth?: number; viewHeight?: number })
  | (StudioRenderBox & { kind: "svg"; svg: string })
  | (StudioRenderBox & { kind: "image"; path: string; fit: StudioImageFit; crop: StudioCrop | null; mask: StudioImageMask; radius: number })
  | (StudioRenderBox & { kind: "qr"; value: string; color: string; background: string | null; errorLevel: StudioQrLevel });

export type StudioRenderItem =
  | StudioRenderShape
  | (StudioRenderBox & { kind: "shadow"; shadow: StudioDropShadow; items: StudioRenderShape[] })
  | (StudioRenderBox & {
      kind: "text";
      runs: StudioRenderRun[];
      fontId: string | null;
      fontSize: number;
      color: string;
      weight: number;
      align: StudioTextAlign;
      verticalAlign: StudioVerticalAlign;
      lineHeight: number;
      letterSpacing: number;
      textCase: StudioTextCase;
      shrinkToFit: boolean;
      autoWidth: boolean;
      paragraphs: StudioParagraph[];
      outline: StudioTextOutline | null;
      shadow: StudioTextShadow | null;
      highlight: StudioTextHighlight | null;
      language?: string;
      segments?: StudioRenderSegment[];
      bands?: StudioRenderBand[];
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
  quality?: number;
  transparent?: boolean;
  pageNumbers?: number[] | null;
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

export type StudioThumbnailParams = { page: StudioRenderPage; language?: string; side?: number };

export type StudioThumbnailResult = { image: string; width: number; height: number };

export type StudioProjectOpenResult = { design: unknown; thumbnail: string; source: "project" | "pdf" };

export type StudioDraftSaveParams = { design: StudioDesign; filePath: string | null };

export type StudioDraftSaveResult = { bytes: number; savedAt: number };

export type StudioDraftLoadResult = { found: boolean; design: unknown; filePath: string | null; savedAt: number };

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
