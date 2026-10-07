import type { LucideIcon } from "lucide-react";

export type Locale = "tr" | "en" | "de" | "fr" | "es" | "it" | "pt-BR" | "ar";

export type ThemeMode = "light" | "dark" | "system";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export type RpcErrorCode =
  | "ENCRYPTED"
  | "NEEDS_PASSWORD"
  | "INVALID_PDF"
  | "CERTIFICATE_SEALED"
  | "FILE_NOT_FOUND"
  | "LIBREOFFICE_MISSING"
  | "EXTERNAL_TOOL_FAILED"
  | "TESSDATA_MISSING"
  | "NETWORK"
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "INVALID_PARAMS"
  | "UNSUPPORTED"
  | "UNKNOWN_METHOD"
  | "INTERNAL"
  | "SIDECAR_SPAWN_FAILED"
  | "SIDECAR_DIED"
  | "SIDECAR_UNAVAILABLE"
  | "KEYCHAIN_UNAVAILABLE"
  | "SECRET_NOT_FOUND"
  | "SECRET_BINDING_CHANGED"
  | "TICKET_INVALID";

export type ChainSecretKind = "encrypt" | "sign";

export type ChainSecretStatus = { chainId: string; encrypt: boolean; sign: boolean };

export type RpcError = {
  code: RpcErrorCode;
  message: string;
  data?: Record<string, unknown>;
};

export type RpcProgress = {
  id: string;
  progress: number;
  message?: string;
  detail?: Record<string, unknown>;
};

export type PageSize = {
  width: number;
  height: number;
  rotation: number;
};

export type DocumentInfo = {
  path: string;
  fileName: string;
  bytes: number;
  pageCount: number;
  encrypted: boolean;
  ownerOnly?: boolean;
  pdfVersion: string | null;
  metadata: Record<string, string>;
  pageSizes: PageSize[];
  hasToc: boolean;
  hasForms: boolean;
  hasAttachments: boolean;
};

export type InfoGetParams = {
  path: string;
  password?: string;
};

export type SystemPingResult = {
  version: string;
  pymupdf: string;
  python: string;
};

export type SystemReleaseParams = {
  path?: string;
};

export type SystemReleaseResult = {
  released: number;
};

export type OpenDocument = {
  id: string;
  path: string;
  fileName: string;
  password: string | null;
  info: DocumentInfo | null;
  infoStatus: AsyncStatus;
  infoError: RpcError | null;
};

export type SourceDocument = {
  path: string;
  fileName: string;
  password: string | null;
  info: DocumentInfo | null;
};

export type RecentFile = {
  path: string;
  fileName: string;
  openedAt: number;
  pinned?: boolean;
};

export type PasswordRequest = {
  documentId: string;
  fileName: string;
  wrongPassword: boolean;
};

export type ToastKind = "info" | "success" | "error";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
};

export type Tone = "organize" | "improve" | "toPdf" | "fromPdf" | "edit" | "security";

export type NavItem = {
  id: string;
  labelKey: string;
  route: string;
  icon: LucideIcon;
  tone?: Tone;
};

export type OutputResult = {
  output: string;
  pageCount: number;
  bytes: number;
};

export type PageRotation = 0 | 90 | 180 | 270;

export type PageScopeKind = "all" | "odd" | "even" | "every" | "ranges";
export type PageScope = { kind: PageScopeKind; ranges?: string; every?: number; start?: number };

export type PagesParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: number[];
  scope?: PageScope;
};

export type RotatePagesParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  scope?: PageScope;
  degrees: 90 | 180 | 270;
};

export type PageTurn = { page: number; rotate: 90 | 180 | 270 };

export type EditPagesParams = {
  path: string;
  password?: string;
  output?: string;
  inPlace?: boolean;
  overwrite?: boolean;
  delete?: number[];
  rotations?: PageTurn[];
};

export type AssembleSource = { id: string; path: string; password?: string };

export type PaperStyle = "lined" | "grid" | "dots" | "isometric" | "handwriting" | "staff";

export type PaperPattern = { style: PaperStyle; spacing: number; color: string; margin?: boolean };

export type AssemblePage =
  | { kind: "page"; source: string; index: number; rotate: PageRotation }
  | { kind: "blank"; width: number; height: number; rotate: PageRotation; paper?: PaperPattern }
  | { kind: "image"; path: string; rotate: PageRotation; width?: number; height?: number };

export type PageLabelStyle = "D" | "r" | "R" | "a" | "A" | "";

export type PageLabelRule = { start: number; style?: PageLabelStyle; prefix?: string; firstNumber?: number };

export type AssembleParams = {
  sources: AssembleSource[];
  pages: AssemblePage[];
  output?: string;
  inPlace?: boolean;
  overwrite?: boolean;
  labels?: PageLabelRule[] | null;
};

export type AssemblePartsParams = {
  sources: AssembleSource[];
  pages: AssemblePage[];
  cuts: number[];
  outputDir: string;
  baseName?: string;
  overwrite?: boolean;
  labels?: PageLabelRule[] | null;
};

export type AssemblePartsResult = { outputs: SplitOutput[] };

export type OrganizerSource = {
  id: string;
  path: string;
  password: string | null;
  fileName: string;
  embedDocId: string | null;
  pageCount: number;
};

export type OrganizerTile = { key: string; rotate: PageRotation } & (
  | { kind: "page"; sourceId: string; index: number }
  | { kind: "blank"; width: number; height: number; paper?: PaperPattern }
  | { kind: "image"; path: string; fileName: string; previewUrl: string }
);

export type PaperPreset = "a4" | "letter" | "a5" | "a3" | "match";

export type MergeInput = { path: string; password?: string; ranges?: string; reverse?: boolean };

export type MergeBookmarkStyle = "nested" | "files" | "originals" | "none";

export type MergeParams = {
  inputs: MergeInput[];
  output: string;
  overwrite?: boolean;
  addBookmarks?: boolean;
  bookmarks?: MergeBookmarkStyle;
  contentsPage?: boolean;
  contentsTitle?: string;
  interleave?: boolean;
  padOdd?: boolean;
  keepProtection?: boolean;
  mailLabels?: MailLabels;
};

export type MergeResult = OutputResult & { protectedFrom: string | null; renamedFields: number };

export type SplitMode = "ranges" | "every" | "count" | "single" | "size" | "bookmarks" | "odd_even" | "text";

export type SplitParams = {
  path: string;
  password?: string;
  mode: SplitMode;
  ranges?: string;
  every?: number;
  parts?: number;
  bookmarkLevel?: number;
  maxBytes?: number;
  textPattern?: string;
  outputDir: string;
  baseName?: string;
  pattern?: string;
  overwrite?: boolean;
};

export type SplitOutput = OutputResult & { firstPage: number; lastPage: number };

export type SplitResult = { outputs: SplitOutput[]; protected: boolean; oversizedParts: number[] };

export type CompressPreset = "light" | "balanced" | "strong" | "extreme";
export type CompressProfile = CompressPreset | "custom";

export type SpaceKind = "image" | "font" | "content" | "metadata" | "attachment" | "other";
export type SpaceGroup = { kind: SpaceKind; bytes: number; count: number };
export type SpaceReport = {
  totalBytes: number;
  storedBytes: number;
  groups: SpaceGroup[];
  imageCount: number;
  largestImageBytes: number;
  squeezableShare: number;
  largestImages?: SpaceImage[];
  largestFonts?: SpaceFont[];
};
export type SpaceImageFormat = "jpeg" | "jpeg2000" | "jbig2" | "ccitt" | "flate" | "none" | "other";
export type SpaceImage = { xref: number; bytes: number; width: number; height: number; format: SpaceImageFormat; pages: number[]; dpi?: number | null };
export type SpaceFont = { xref: number; bytes: number; name: string; subset: boolean; format: "type1" | "truetype" | "cff" | "opentype" };

export type CompressParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  profile: CompressProfile;
  grayscale?: boolean;
  stripMetadata?: boolean;
  discardExtras?: boolean;
  linearize?: boolean;
  targetBytes?: number;
  customDpi?: number;
  customQuality?: number;
  removeAttachments?: boolean;
  removeComments?: boolean;
  removeScripts?: boolean;
};

export type CompressPreviewParams = Pick<CompressParams, "path" | "password" | "profile" | "customDpi" | "customQuality" | "grayscale"> & { page: number; dpi?: number };
export type CompressPreviewResult = { before: string; after: string; width: number; height: number; pageCount: number; bytesBefore: number; bytesAfter: number };

export type CompressResult = {
  output: string;
  pageCount: number;
  bytesBefore: number;
  bytesAfter: number;
  profileUsed: string;
  targetBytes?: number | null;
  targetMet?: boolean | null;
  keptOriginal?: boolean;
  fontBytesSaved?: number;
  extrasRemoved?: number;
  linearized?: boolean;
  privacyOnly?: boolean;
  grew?: boolean;
  attachmentsRemoved?: number;
  commentsRemoved?: number;
  scriptsRemoved?: number;
};

export type Permissions = {
  print: boolean;
  printHighQuality: boolean;
  copyText: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  accessibility: boolean;
  assemble: boolean;
};

export type EncryptAlgorithm = "aes256" | "aes128" | "rc4";

export type EncryptParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  userPassword: string;
  ownerPassword: string;
  algorithm: EncryptAlgorithm;
  permissions: Permissions;
  encryptMetadata?: boolean;
};
export type EncryptCertificateParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  certificates: string[];
  algorithm: EncryptAlgorithm;
  permissions: Permissions;
  encryptMetadata?: boolean;
};
export type EncryptCertificateResult = OutputResult & { recipients: string[]; expiredRecipients: string[] };
export type EncryptResult = OutputResult & { generatedOwnerPassword: string };
export type PasswordBreachParams = { password: string; online?: boolean };
export type PasswordBreachResult = { breached: boolean; count?: number | null; source: "offline" | "online"; match?: "exact" | "variant" | null };
export type DecryptCertificateParams = {
  path: string;
  output: string;
  overwrite?: boolean;
  certificatePath: string;
  certificatePassword?: string;
};

export type DecryptParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
};

export type ViewSource = { token: string; length: number };

export type LaunchRequest = {
  tool: string | null;
  paths: string[];
};

export type TrayLabels = {
  tooltip: string;
  open: string;
  pause: string;
  resume: string;
  quit: string;
};

export type AutostartStatus = {
  supported: boolean;
  enabled: boolean;
  trayByDefault: boolean;
};

export type ShellMenuEntry = {
  id: string;
  label: string;
  tool: string;
  extensions: string[];
};

export type WatermarkCandidate = {
  id: string;
  kind: "text" | "image" | "annotation" | "stampAnnotation" | "tagged" | "artifact" | "layer" | "raster";
  text?: string;
  digest?: string;
  layer?: number;
  coverage?: number;
  pages: number;
  samplePage: number;
  rotated: boolean;
  faint: boolean;
  fontSize?: number;
  preview?: string;
  width?: number;
  height?: number;
  confident: boolean;
};

export type DetectWatermarkResult = { candidates: WatermarkCandidate[]; pagesScanned: number; pageCount: number };

export type RemoveWatermarkParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  text?: string;
  texts?: string[];
  annotations?: boolean;
  stampAnnotations?: boolean;
  repeatedImages?: boolean;
  imageDigests?: string[];
  tagged?: boolean;
  artifacts?: boolean;
  layers?: number[];
  raster?: boolean;
  pages?: string;
};

export type RemoveWatermarkResult = OutputResult & {
  removedText: number;
  removedAnnotations: number;
  removedImages: number;
  removedMarks: number;
  repaintedPages: number;
  solidInkPages?: number;
};

export type PrivacyLink = { page: number; uri: string };
export type PrivacyReport = {
  metadata: Record<string, string>;
  xmpMetadata: boolean;
  javascript: number;
  embeddedFiles: string[];
  fileAttachments: number;
  annotations: number;
  links: PrivacyLink[];
  linkCount: number;
  layers: number;
  hiddenLayers: number;
  formFields: number;
  hiddenText: number;
  bookmarks: number;
  privateData?: number;
  offPageContent?: number;
  thumbnails?: number;
  signatures?: number;
  imageMetadata?: number;
  sensitive: Partial<Record<RedactPreset, number>>;
  pageCount: number;
};
export type SanitizeOption = "metadata" | "xmpMetadata" | "imageMetadata" | "thumbnails" | "javascript" | "embeddedFiles" | "fileAttachments" | "annotations" | "links" | "hiddenText" | "offPage" | "hiddenLayers" | "bookmarks" | "privateData" | "resetForms";
export type SanitizeParams = { path: string; password?: string; output: string; overwrite?: boolean } & Partial<Record<SanitizeOption, boolean>>;
export type SanitizeResult = OutputResult & { removed: Partial<Record<string, number>> };

export type ScanColorMode = "color" | "gray" | "bw";
export type ScanEnhanceMode = "auto" | ScanColorMode;
export type ScanEnhanceParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  onlyScanned: boolean;
  dpi: number;
  deskew: boolean;
  despeckle: boolean;
  whiten: boolean;
  contrast: number;
  mode: ScanEnhanceMode;
  orientation: boolean;
  removeBlank?: boolean;
  cleanEdges?: boolean;
  languages: string[];
  jpegQuality: number;
};
export type ScanEnhanceResult = OutputResult & { enhancedPages: number; skippedPages: number; deskewedPages: number; rotatedPages: number; removedPages: number; ocrKeptPages: number; ocrDroppedPages: number };
export type ScanEnhancePreviewParams = Pick<ScanEnhanceParams, "path" | "password" | "deskew" | "despeckle" | "whiten" | "contrast" | "mode" | "cleanEdges"> & { page: number; dpi?: number };
export type ScanEnhancePreviewResult = { before: string; after: string; afterFormat: "jpeg" | "png"; width: number; height: number; angle: number; mode: ScanColorMode; pageCount: number };
export type ScanSplitMode = "blank" | "qr" | "barcode" | "text";
export type ScanSplitParams = {
  path: string;
  password?: string;
  outputDir: string;
  pattern: string;
  overwrite?: boolean;
  mode: ScanSplitMode;
  dropSeparators: boolean;
  qrPrefix?: string;
  textPattern?: string;
  minPages: number;
  blankRun?: number;
  parts?: ScanSplitPart[];
};
export type ScanSplitPart = { firstPage: number; lastPage: number; label: string | null };
export type ScanSplitRules = Omit<ScanSplitParams, "outputDir" | "pattern" | "overwrite" | "parts">;
export type SeparatorSheetParams = { output: string; overwrite?: boolean; labels: string[]; prefix: string; title: string; hint?: string; paper?: "a4" | "letter" };
export type SeparatorSheetResult = OutputResult & { separatorSheets: number };
export type ScanSplitPreviewPart = { firstPage: number; lastPage: number; pageCount: number; label: string | null };
export type ScanSplitPreviewResult = { parts: ScanSplitPreviewPart[]; separatorPages: number[]; pageCount: number; pagesWithoutText: number };
export type ScanSplitOutput = { output: string; pageCount: number; bytes: number; firstPage: number; lastPage: number; label: string | null };
export type ScannerDevice = { id: string; name: string; feeder: boolean; flatbed: boolean; duplex: boolean };
export type ScannerDevicesResult = { supported: boolean; devices: ScannerDevice[]; reason?: "saneMissing" | "deviceError" | null };
export type ScannerAcquireParams = {
  deviceId?: string;
  output: string;
  session?: boolean;
  overwrite?: boolean;
  source?: "auto" | "flatbed" | "feeder";
  dpi?: number;
  mode?: ScanColorMode;
  sheets?: number;
  duplex?: boolean;
  deskew?: boolean;
  despeckle?: boolean;
  whiten?: boolean;
  skipBlank?: boolean;
  jpegQuality?: number;
};
export type ScannerInterruption = "paperJam" | "coverOpen" | "scannerOffline" | "scannerStopped";
export type ScannerAcquireResult = OutputResult & { device: string; sheets: number; skippedBlank: number; interrupted?: ScannerInterruption | null };
export type ScanSessionPage = { path: string; page: number; rotation?: 0 | 90 | 180 | 270 };
export type ScannerAssembleParams = { pages: ScanSessionPage[]; output: string; overwrite?: boolean; ocr?: boolean; languages?: string[]; discard?: boolean };
export type ScannerAssembleResult = OutputResult & { ocrPages: number };
export type ScannerDiscardResult = { removed: number };
export type ScanPhotoParams = {
  images: string[];
  output: string;
  overwrite?: boolean;
  autoCrop?: boolean;
  whiten?: boolean;
  mode?: ScanEnhanceMode;
  paper?: "auto" | "a4" | "letter";
  jpegQuality?: number;
  corners?: Array<Array<[number, number]> | null>;
  cornerSizes?: Array<[number, number] | null>;
  frameCorners?: Array<Array<Array<[number, number]> | null> | null>;
  rotations?: PhotoRotation[];
};
export type PhotoRotation = 0 | 90 | 180 | 270;
export type ScanPhotoDetectParams = { image: string; frame?: number; previewSide?: number };
export type ScanPhotoDetectResult = { width: number; height: number; detected: boolean; corners: Array<[number, number]>; frames: number; frame: number; preview: string; previewWidth: number; previewHeight: number };
export type ScanPhotoPage = { source: string; cropped: boolean; width: number; height: number };
export type ScanPhotoResult = OutputResult & { pages: ScanPhotoPage[] };
export type ScanSplitResult = { outputs: ScanSplitOutput[]; separatorPages: number[] };

export type RenameCase = "keep" | "lower" | "upper" | "title";
export type RenameDateOrder = "dmy" | "mdy";
export type RenameReplacement = { find: string; replace: string; regex?: boolean };
export type RenamePreviewParams = {
  paths: string[];
  password?: string;
  passwords?: Record<string, string>;
  pattern: string;
  customPatterns?: Record<string, string>;
  maxPages?: number;
  dateFormat?: string;
  dateOrder?: RenameDateOrder;
  counterStart?: number;
  counterStep?: number;
  counterDigits?: number;
  case?: RenameCase;
  turkishCase?: boolean;
  replacements?: RenameReplacement[];
  overrides?: Record<string, string>;
  ocr?: boolean;
  ocrLanguages?: string[];
};
export type RenameItem = { path: string; newName: string; fields: Record<string, string>; conflict: boolean; error: string | null; bytes: number; modified: number; recognised: boolean };
export type RenamePreviewResult = { items: RenameItem[] };
export type RenameApplyParams = {
  items: Array<{ path: string; newName: string }>;
  mode: "rename" | "copy";
  outputDir?: string;
  overwrite?: boolean;
  autoUnique?: boolean;
};
export type RenameOutcome = { path: string; output: string | null; ok: boolean; error: string | null; replaced: boolean };
export type RenameApplyResult = { results: RenameOutcome[]; renamed: number; createdDirs: string[] };
export type RenameUndoParams = { items: Array<{ path: string; original: string }>; removeDirs?: string[] };
export type RenameUndoResult = { results: RenameOutcome[]; restored: number };

export type SearchFolder = { path: string; recursive: boolean; files: number; pages: number; lastIndexed: number | null };
export type SearchIndexStats = { indexed: number; unchanged: number; skipped: number; removed: number; pages: number };
export type SearchFoldersResult = { folders: SearchFolder[]; database: string };
export type SearchIndexResult = { folders: SearchFolder[]; stats: SearchIndexStats };
export type SearchPageHit = { page: number; snippet: string };
export type SearchFileHit = { path: string; title: string; pages: number; folder: string; matchedPages: SearchPageHit[]; pageHits: number };
export type SearchQueryResult = { files: SearchFileHit[]; totalFiles: number };
export type SearchQueryParams = {
  query: string;
  limit?: number;
  folder?: string;
  path?: string;
  modifiedAfter?: number;
  modifiedBefore?: number;
  minPages?: number;
  maxPages?: number;
};
export type SearchStatsResult = { path: string; sizeBytes: number; files: number; pages: number; unindexable: number };

export type CommentItem = {
  xref: number;
  page: number;
  type: string;
  author: string;
  subject: string;
  content: string;
  created: string;
  modified: string;
  color: string | null;
  rect: number[];
  resolved: boolean;
  quote: string;
  parent: number | null;
  state: ReviewState | null;
};
export type ReviewState = "Accepted" | "Rejected" | "Cancelled" | "Completed";
export type CommentsListResult = { items: CommentItem[]; authors: string[]; types: string[]; pageCount: number };
export type CommentsExportParams = { path: string; password?: string; output: string; format: "csv" | "pdf" | "xfdf" | "fdf" | "md"; includeResolved: boolean; overwrite?: boolean; layout?: "list" | "pages"; pageLabel?: string; typeLabels?: Record<string, string> };
export type CommentsExportResult = { output: string; count: number };
export type CommentsImportParams = { path: string; password?: string; source: string; output: string; overwrite?: boolean; replaceExisting?: boolean };
export type CommentsImportResult = OutputResult & { imported: number; skipped: number; duplicates: number };

export type PageText = { page: number; text: string };
export type PageTextResult = { pages: PageText[]; pageCount: number };
export type PictureArea = { x: number; y: number; width: number; height: number };
export type PageTone = { page: number; dark: boolean; pictures: PictureArea[] };
export type PageTonesResult = { pages: PageTone[] };
export type ReadingTheme = "paper" | "sepia" | "dark";
export type ReadingWidth = "narrow" | "medium" | "wide";

export type CodeHit = { page: number; format: string; text: string; x0: number; y0: number; x1: number; y1: number };
export type CodesReadResult = { codes: CodeHit[]; pagesScanned: number };
export type OmrPaper = "a4" | "letter";
export type OmrLetterCase = "upper" | "lower";
export type OmrSheetParams = { output: string; overwrite?: boolean; paper?: OmrPaper; questions: number; options?: number; letterCase?: OmrLetterCase; idDigits?: number; booklets?: number; copies?: number; title?: string; labels?: { name?: string; studentId?: string; booklet?: string; hint?: string } };
export type OmrSheetResult = OutputResult & { capacity: number };
export type OmrMarkState = "blank" | "single" | "multiple" | "unclear";
export type OmrMark = { state: OmrMarkState; chosen: number[]; fills: number[] };
export type OmrScan = { source: string; page: number | null; layout: string; questions: number; options: number; idDigits: number; booklets: number; letterCase: OmrLetterCase; studentId: string; idMarks: OmrMark[]; booklet: OmrMark | null; marks: OmrMark[]; transform: number[]; pixelScale: number };
export type OmrFailure = { source: string; page: number | null; reason: "noSheetCode" | "cornersNotFound" | "unreadable" };
export type OmrReadParams = { paths: string[]; password?: string; threshold?: number };
export type OmrReadResult = { sheets: OmrScan[]; failures: OmrFailure[] };
export type OmrReviewQuestion = { chosen: number[]; key: number[]; verdict: "correct" | "wrong" | "blank" | "void" | "unclear" };
export type OmrReviewItem = { source: string; page: number | null; layout: string; transform: number[]; pixelScale: number; header?: string; questions: OmrReviewQuestion[] };
export type OmrReviewParams = { output: string; overwrite?: boolean; password?: string; items: OmrReviewItem[] };
export type OmrTable = { title: string; header: string[]; rows: Array<Array<string | number | null>> };
export type OmrExportParams = { output: string; overwrite?: boolean; format?: "csv" | "xlsx"; delimiter?: "," | ";" | "	"; tables: OmrTable[] };
export type OmrExportResult = { output: string; rows: number };
export type CodesReadParams = { path: string; password?: string; pages?: string; dpi?: number; thorough?: boolean };
export type CodesExportParams = { codes: CodeHit[]; output: string; overwrite?: boolean };
export type CodesExportResult = { output: string; count: number };
export type QrPosition = GridPosition;
export type CodeFormat = "qr" | "microQr" | "dataMatrix" | "aztec" | "pdf417" | "code128" | "code39" | "code93" | "ean13" | "ean8" | "upca" | "upce" | "itf" | "codabar";
export const CODE_FORMATS = ["qr", "microQr", "dataMatrix", "aztec", "pdf417", "code128", "code39", "code93", "ean13", "ean8", "upca", "upce", "itf", "codabar"] as const;
export const SQUARE_CODE_FORMATS: CodeFormat[] = ["qr", "microQr", "dataMatrix", "aztec"];
export type QrAddParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  text: string;
  values?: string[];
  format?: CodeFormat;
  size: number;
  height?: number;
  position: QrPosition;
  margin: number;
  errorLevel?: "L" | "M" | "Q" | "H";
  color?: string;
  background?: string;
  caption?: boolean;
  captionSize?: number;
};
export type QrAddResult = OutputResult & { stamped: number; verified: boolean; unused?: number; missingGlyphs?: string };

export type CsvDelimiter = "auto" | "," | ";" | "\t" | "|";
export type DataPreviewParams = { path: string; sheet?: string; delimiter?: CsvDelimiter; limit?: number };
export type DataPreviewResult = { columns: string[]; rows: Array<Record<string, string>>; totalRows: number; sheets: string[] };
export type FormMergeParams = {
  path: string;
  password?: string;
  dataPath: string;
  sheet?: string;
  delimiter?: CsvDelimiter;
  outputDir: string;
  pattern: string;
  mapping: Record<string, string | null>;
  flatten: boolean;
  overwrite?: boolean;
  limit?: number;
  language?: string;
};
export type FormMergeFailure = { row: number; code: RpcErrorCode; reason?: string | null; field?: string | null; value?: string | null };
export type FormMergeResult = {
  outputs: Array<{ output: string; row: number }>;
  rows: number;
  skipped: number;
  unmatchedFields: string[];
  failed?: FormMergeFailure[];
  recalculated?: number;
  calcSkipped?: number;
};
export type ExportDelimiter = "," | ";" | "\t";
export type FormExportParams = { paths: string[]; password?: string; output: string; format: "csv" | "xlsx"; delimiter?: ExportDelimiter; overwrite?: boolean; checkedLabel?: string; uncheckedLabel?: string };
export type FormExportResult = { output: string; files: number; columns: string[]; failed: string[] };
export type FormDetectParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  minLineWidth: number;
  fieldHeight: number;
};
export type DetectedField = { name: string; kind: "text" | "checkbox"; page: number; rect: number[]; label: string };
export type FormDetectResult = OutputResult & { fields: DetectedField[]; scannedPages?: number[] };
export type FormDataFormat = "xfdf" | "fdf";
export type FormDataExportParams = { path: string; password?: string; output: string; format: FormDataFormat; overwrite?: boolean; values?: Record<string, string | boolean | string[]> };
export type FormDataExportResult = { output: string; fields: number };
export type FormDataImportParams = { path: string; password?: string; dataPath: string; output: string; overwrite?: boolean; flatten?: boolean; language?: string };
export type FormDataImportResult = OutputResult & { filled: number; unmatched: string[]; recalculated?: number; calcSkipped?: number };

export type AccessStatus = "pass" | "warn" | "fail";
export type AccessCheck = { id: string; status: AccessStatus; value?: string | null; count?: number | null; pages?: number[] };
export type AccessFigure = { xref: number; page: number | null; alt: string; kind: string };
export type PreflightCheck = { id: string; status: AccessStatus; count?: number | null; value?: string | null; pages?: number[]; variant?: string | null };
export type PreflightProfile = "digital" | "offset" | "pdfx1a" | "pdfx4";
export type PreflightLowImage = { page: number; dpi: number; width: number; height: number };
export type PreflightReport = {
  pageCount: number;
  pdfVersion: string;
  encrypted: boolean;
  pageSizes: string[];
  unembeddedFonts: string[];
  images: number;
  minDpi: number | null;
  lowImages: PreflightLowImage[];
  lowImageCount: number;
  colorSpaces: Record<string, number>;
  vectorColorSpaces?: Record<string, number>;
  transparencyPages: number;
  annotations: number;
  formFields: number;
  blankPages: number;
  hairlinePages: number;
  edgePages: number;
  hasBleed: boolean;
  profile?: PreflightProfile;
  outputIntent?: string | null;
  pdfxVersion?: string | null;
  maxInkCoverage?: number | null;
  smallestText?: number | null;
  checks: PreflightCheck[];
  ready: boolean;
};

export type AccessReport = {
  tagged: boolean;
  title: string;
  displayDocTitle: boolean;
  language: string | null;
  hasBookmarks: boolean;
  pageCount: number;
  figures: AccessFigure[];
  figuresTotal: number;
  figuresWithoutAlt: number;
  headings: Record<string, number>;
  headingSkips: number;
  tables: number;
  imagesUntagged: number;
  scannedPages: number;
  unembeddedFonts: string[];
  unlabelledFields: number;
  tablesWithoutHeaders?: number;
  tabOrderPages?: number;
  linksWithoutText?: number;
  accessPermission?: boolean;
  untaggedContentPages?: number;
  readingOrderPages?: number;
  lists?: number;
  listErrors?: number;
  lowContrastRuns?: number;
  lowContrastPages?: number;
  pdfUa?: string | null;
  unmappedTypes?: string[];
  checks: AccessCheck[];
  score: number;
};
export type AccessFixParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  title?: string;
  language?: string;
  displayDocTitle?: boolean;
  altTexts: Record<number, string>;
  tabOrder?: boolean;
  linkText?: boolean;
  autoTag?: boolean;
};
export type AccessAutoTagSummary = { paragraphs: number; headings: number; figures: number; artifacts: number; annotations: number; pages: number };
export type AccessFixResult = OutputResult & { changes: number; score: number; autoTagged?: AccessAutoTagSummary | null; figuresWithoutAlt?: number };
export type AccessFigurePreviewParams = { path: string; password?: string; xref: number; maxSize?: number };
export type AccessFigurePreviewResult = { image: string; page: number; exact: boolean };

export type GridPosition = "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";
export type StampPosition = GridPosition;

export type StampParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  text: string;
  color?: string;
  fontSize?: number;
  position?: StampPosition;
  margin?: number;
  rotation?: number;
  opacity?: number;
  border?: boolean;
  name?: string;
  dateFormat?: string;
  fontId?: string;
  side?: PageSide;
  behind?: boolean;
  offsetX?: number;
  offsetY?: number;
};

export type MarkPreviewResult = { image: string; width: number; height: number; page: number; pageCount: number; missingGlyphs: string; pagesProblem: "" | "badRange" | "noPagesSelected" };
export type FontSourceKind = "bundled" | "system" | "imported" | "library";
export type FontChoice = { id: string; name: string; source: FontSourceKind; styles: string[]; installed?: boolean; bytes?: number; category?: string; weights?: number[] };
export type FontLibraryFamily = { id: string; name: string; category: string; bytes: number; installed: boolean; styles: string[] };
export type FontCatalogueResult = { fonts: FontChoice[] };
export type FontRemoveResult = { removed: boolean };

export type StampPreviewParams = Omit<StampParams, "output" | "overwrite"> & { width?: number };

export type SetMetadataParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string };
export type SetMetadataResult = OutputResult & { metadata: Record<string, string> };
export type ExtractImagesParams = { path: string; password?: string; outputDir: string; pages?: string; minSize?: number; dedupe?: boolean };
export type ExtractImagesResult = { outputs: string[]; count: number; skipped: number; bytes: number };
export type FindTextParams = { path: string; password?: string; query: string; matchCase?: boolean; wholeWord?: boolean };
export type FindTextResult = { pages: number[] };
export type DetectRotationParams = { path: string; password?: string; pages?: string; ocr?: boolean; languages?: string[] };
export type PageRotationItem = { page: number; rotation: number; method: string };
export type DetectRotationResult = { items: PageRotationItem[]; upright: number[]; checked: number };
export type AutoRotateParams = DetectRotationParams & { output: string; overwrite?: boolean };
export type AutoRotateResult = OutputResult & { rotated: number };
export type LetterheadParams = { path: string; password?: string; output: string; overwrite?: boolean; templatePath: string; templatePassword?: string; templatePage?: number; firstPageTemplatePath?: string; firstPageTemplatePassword?: string; firstPageTemplatePage?: number; position?: "under" | "over"; fit?: "stretch" | "fit"; pages?: string; replaceExisting?: boolean };
export type LetterheadResult = OutputResult & { applied: number };
export type FindReplaceParams = { path: string; password?: string; output: string; overwrite?: boolean; find: string; replace: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; pages?: string };
export type FindPreviewParams = { path: string; password?: string; find: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; pages?: string; limit?: number };
export type FindHit = { page: number; text: string; context: string };
export type FindPreviewResult = { hits: FindHit[]; total: number; pagesSearched: number; hidden?: number };
export type FindReplaceResult = OutputResult & { replaced: number; pagesChanged: number; warnings: TextEditWarning[] };
export type LinkItem = { page: number; xref: number; kind: "uri" | "page" | "other"; uri?: string | null; targetPage?: number | null; rect: number[] };
export type LinksListResult = { items: LinkItem[]; count: number };
export type NewLink = { page: number; x0: number; y0: number; x1: number; y1: number; uri?: string; targetPage?: number };
export type LinksAddParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; links: NewLink[] };
export type LinksRemoveParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; items: Array<{ page: number; xref: number }> };
export type LinksChangedResult = OutputResult & { changed: number };
export type AutoLinkParams = {
  path: string;
  password?: string;
  output?: string;
  inPlace?: boolean;
  overwrite?: boolean;
  urls?: boolean;
  emails?: boolean;
  pages?: string;
};
export type AutoLinkResult = OutputResult & { added: number; pagesChanged: number };
export type PdfaLevel = "1b" | "2b" | "2u" | "3b";
export type PdfaCheckId =
  | "encryption"
  | "actions"
  | "fonts"
  | "colour"
  | "outputIntent"
  | "metadata"
  | "annotations"
  | "forms"
  | "attachments"
  | "compression"
  | "images"
  | "layers"
  | "transparency"
  | "jpeg2000"
  | "objectStreams"
  | "unicode";
export type PdfaCheck = { id: PdfaCheckId; status: "pass" | "fail"; fixable: boolean; count?: number | null; value?: string | null };
export type PdfaReport = { level: PdfaLevel; pageCount: number; claimed: string | null; checks: PdfaCheck[]; ready: boolean; convertible: boolean };
export type PdfaCheckParams = { path: string; password?: string; level?: PdfaLevel };
export type PdfaConvertParams = { path: string; password?: string; output: string; overwrite?: boolean; level?: PdfaLevel };
export type PdfaValidatorResult = { available: boolean; version?: string | null };
export type PdfaRule = { specification: string; clause: string; testNumber: string; description: string; failedChecks: number };
export type PdfaValidateResult = { level: PdfaLevel; compliant: boolean; version: string | null; failedRules: number; failedChecks: number; rules: PdfaRule[]; truncated: boolean };
export type PdfaConvertResult = OutputResult & { fixed: PdfaCheckId[]; report: PdfaReport };
export type ImageAtResult = { found: boolean; xref?: number | null; width?: number | null; height?: number | null; ext?: string | null; rect?: number[] | null; pngBase64?: string | null };
export type PrinterInfo = { name: string; isDefault: boolean };
export type PrintersResult = { printers: PrinterInfo[]; default?: string | null; backend: "windows" | "cups" | "none" };
export type PrintSubset = "all" | "odd" | "even";
export type PagesPerSheet = 1 | 2 | 4 | 6 | 9;
export type PrintRunParams = { path: string; password?: string; printer?: string; pages?: string; copies?: number; scale?: "fit" | "actual"; grayscale?: boolean; subset?: PrintSubset; reverse?: boolean; annotations?: boolean; autoRotate?: boolean; pagesPerSheet?: PagesPerSheet };
export type PrintRunResult = { printer: string; pages: number; copies: number; sheets: number };
export type ImageSaveResult = { output: string; ext: string; width: number; height: number; bytes: number };
export type EditorFontOrigin = { path: string; password?: string | null };
export type EditorRun = { text: string; font?: string | null; fontXref?: number; fontSource?: EditorFontOrigin | null; size: number; color?: string; bold?: boolean; italic?: boolean; superscript?: boolean };
export type EditorTextObject = { id?: string; kind: "text"; page: number; x0: number; y0: number; x1: number; y1: number; text: string; fontSize?: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; opacity?: number; fontId?: string; runs?: EditorRun[] };
export type EditorImageObject = { id?: string; kind: "image"; page: number; x0: number; y0: number; x1: number; y1: number; pngBase64?: string; path?: string; opacity?: number; alt?: string };
export type EditorDrawingObject = { id?: string; kind: "drawing"; page: number; x0: number; y0: number; x1: number; y1: number; svg: string; opacity?: number; alt?: string };
export type TableBorder = "all" | "horizontal" | "outer" | "none";
export type TableAlign = "left" | "center" | "right";
export type TableCellStyle = { fill?: string | null; color?: string | null; align?: TableAlign | null; bold?: boolean | null };
export type TableSpec = { cells: string[][]; columnWidths: number[]; align: TableAlign[]; width: number; fontSize?: number; fontId?: string | null; header?: boolean; border?: TableBorder; color?: string; borderColor?: string; headerFill?: string | null; stripes?: boolean; stripeFill?: string | null; borderWidth?: number | null; cellStyles?: TableCellStyle[][] | null };
export type TablePreviewResult = { svg: string; width: number; height: number; missingGlyphs: string; rowHeights?: number[]; columnWidths?: number[] };
export type EditorTableObject = TableSpec & { id?: string; kind: "table"; page: number; x0: number; y0: number; x1: number; y1: number; opacity?: number; alt?: string };
export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "histogram" | "box" | "dotplot";
export type ChartSeries = { name: string; color: string; values: Array<number | null> };
export type ChartLegendPosition = "bottom" | "top" | "right" | "left";
export type ChartSpec = { type: ChartType; categories: string[]; series: ChartSeries[]; title?: string; categoryTitle?: string; valueTitle?: string; legend?: boolean; legendPosition?: ChartLegendPosition; grid?: boolean; valueLabels?: boolean; stacked?: boolean; width?: number; height?: number; fontSize?: number; fontId?: string | null; color?: string; palette?: string[]; decimal?: "." | ","; bins?: number | null };
export type ChartPreviewResult = { svg: string; width: number; height: number; missingGlyphs: string };
export type EditorChartObject = ChartSpec & { id?: string; kind: "chart"; page: number; x0: number; y0: number; x1: number; y1: number; opacity?: number; alt?: string };
export type QuestionLayout = "auto" | "stack" | "two" | "row";
export type LetterCase = "upper" | "lower";
export type QuestionSpec = { number?: number | null; stem?: string; options?: string[]; layout?: QuestionLayout; letterCase?: LetterCase; answer?: number | null; markAnswer?: boolean; answerLines?: number; width?: number; fontSize?: number; fontId?: string | null; color?: string; lineColor?: string };
export type QuestionPreviewResult = { svg: string; width: number; height: number; missingGlyphs: string };
export type EditorQuestionObject = QuestionSpec & { id?: string; kind: "question"; page: number; x0: number; y0: number; x1: number; y1: number; opacity?: number; alt?: string };
export type FlowShape = "process" | "terminal" | "decision" | "io" | "connector";
export type FlowDirection = "down" | "right";
export type FlowchartSpec = { nodes: Array<{ id: string; shape?: FlowShape; text?: string }>; edges?: Array<{ source: string; target: string; label?: string }>; direction?: FlowDirection; fontSize?: number; fontId?: string | null; color?: string; stroke?: string; fill?: string | null };
export type FlowchartPreviewResult = { svg: string; width: number; height: number; missingGlyphs: string };
export type EditorFlowchartObject = FlowchartSpec & { id?: string; kind: "flowchart"; page: number; x0: number; y0: number; x1: number; y1: number; opacity?: number; alt?: string };
export type EditorReplaceObject = { id?: string; kind: "edit"; page: number; x0: number; y0: number; x1: number; y1: number; text: string; fontSize?: number; color?: string; bold?: boolean; italic?: boolean; font?: string | null; opacity?: number };
export type EditorBlockObject = { id?: string; kind: "block"; page: number; x0: number; y0: number; x1: number; y1: number; text: string; fontSize?: number; color?: string; bold?: boolean; italic?: boolean; font?: string | null; align?: "left" | "center" | "right" | "justify"; lineHeight?: number; fontXref?: number; original?: number[]; runs?: EditorRun[]; firstLineIndent?: number; leading?: number; rotated?: boolean; opacity?: number };
export type EditorImageChangeObject = { id?: string; kind: "imageChange"; page: number; x0: number; y0: number; x1: number; y1: number; xref: number; newX0?: number; newY0?: number; newX1?: number; newY1?: number; replacementPngBase64?: string; replacementPath?: string; rotate?: 0 | 90 | 180 | 270; flipH?: boolean; flipV?: boolean; aspectLocked?: boolean; opacity?: number };
export type EditorObject = EditorTextObject | EditorImageObject | EditorDrawingObject | EditorTableObject | EditorChartObject | EditorQuestionObject | EditorFlowchartObject | EditorReplaceObject | EditorBlockObject | EditorImageChangeObject;
export type EditorTextRun = { text: string; font: string; fontXref: number; fontFamily: string; size: number; color: string; bold: boolean; italic: boolean; superscript: boolean };
export type EditorTextLine = { text: string; bbox: number[]; runs: EditorTextRun[]; hardBreak?: boolean };
export type EditorTextBlock = { id: string; kind: "text"; bbox: number[]; text: string; font: string; size: number; color: string; bold: boolean; italic: boolean; align: "left" | "center" | "right" | "justify"; lineHeight: number; lineCount: number; fontXref: number; fontExt: string; fontFamily: string; textLines: EditorTextLine[]; firstLineIndent: number; leading: number; rotated: boolean };
export type EditorFontResult = { name: string; ext: string; base64: string };
export type EditorFontSource = "embedded" | "system" | "base14" | "fallback";
export type EditorFontResolution = { family: string; source: EditorFontSource; missingGlyphs: string; fontId?: string | null };
export type FontFileResult = { name: string; ext: string; base64: string; italic?: boolean };
export type EditorFontPlanParams = { path: string; password?: string; page: number; fontXref?: number; fontFamily?: string | null; bold?: boolean; italic?: boolean; text: string };
export type EditorImageBlock = { id: string; kind: "image"; bbox: number[]; xref: number; width: number; height: number; placementRotation?: 0 | 90 | 180 | 270 };
export type EditorBlockInfo = EditorTextBlock | EditorImageBlock;
export type EditorBlocksResult = { width: number; height: number; blocks: EditorBlockInfo[] };
export type EditorApplyParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; objects: EditorObject[] };
export type EditorWarningCode = "fontSubstituted" | "glyphsMissing" | "textOverflow" | "rotatedText" | "skewedImage";
export type EditorWarningSeverity = "info" | "warning";
export type EditorWarning = { objectId: string; code: EditorWarningCode; detail: string; severity: EditorWarningSeverity };
export type EditorApplyResult = OutputResult & { applied: number; warnings: EditorWarning[] };
export type EditorSystemFontFamily = { family: string; styles: string[] };
export type EditorSystemFontsResult = { families: EditorSystemFontFamily[] };
export type InsertFromParams = { path: string; password?: string; sourcePath: string; sourcePassword?: string; sourcePages: number[]; at?: number };
export type InsertFromResult = OutputResult & { inserted: number };
export type ImagePreviewResult = { pngBase64: string; width: number; height: number };
export type TtsVoiceSource = "catalog" | "custom";
export type TtsSpeaker = { id: number; name: string };
export type TtsVoice = { id: string; language: string; locale: string; name: string; quality: string; sizeMb: number; installed: boolean; source: TtsVoiceSource; speakers?: number; speakerChoices?: TtsSpeaker[] };
export type TtsVoicesResult = { directory: string; voices: TtsVoice[] };
export type TtsVoiceChangedResult = { id: string; installed: string[] };
export type TtsSynthesizeChunk = { text: string; start: number; end: number; wavBase64: string; durationMs: number };
export type TtsSynthesizeResult = { wavBase64: string; sampleRate: number; durationMs: number; chunks: TtsSynthesizeChunk[] };
export type TranslateModel = { id: string; source: string; target: string; version: string; sizeMb: number; installed: boolean; origin: "catalog" | "custom" };
export type TranslateModelsResult = { directory: string; models: TranslateModel[] };
export type TranslateModelChangedResult = { id: string; installed: string[] };
export type TranslateTextResult = { text: string; source: string; target: string; route: string[] };

export type SignatureCleanResult = { pngBase64: string; width: number; height: number };
export type SignaturePlacementParams = { page: number; x0: number; y0: number; x1: number; y1: number; pngBase64: string };
export type SignaturePlaceParams = { path: string; password?: string; output: string; overwrite?: boolean; placements: SignaturePlacementParams[] };
export type SignaturePlaceResult = OutputResult & { placed: number };

export type StampResult = OutputResult & { stamped: number };

export type AttachmentItem = { name: string; fileName: string; size: number; description: string; modified: string };
export type AttachmentsListResult = { items: AttachmentItem[]; count: number };
export type AttachmentsChangedResult = { changed: number; names: string[] };
export type AttachmentsExtractResult = { outputs: string[] };

export type WatermarkPosition = GridPosition | "tile";

export type PageSide = "all" | "odd" | "even";
export type WatermarkKind = "text" | "image" | "pdf";
export type WatermarkParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  kind: WatermarkKind;
  text?: string;
  imagePath?: string;
  templatePath?: string;
  templatePage?: number;
  fontSize: number;
  bold: boolean;
  color: string;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  scale: number;
  pages?: string;
  side?: PageSide;
  fontId?: string;
  tileGap?: number;
  offsetX?: number;
  offsetY?: number;
  behind?: boolean;
  flatten?: boolean;
  flattenDpi?: number;
  visibility?: WatermarkVisibility;
};

export type WatermarkVisibility = "always" | "print" | "screen";
export type WatermarkPreviewParams = Omit<WatermarkParams, "output" | "overwrite" | "flatten" | "flattenDpi" | "visibility"> & { width?: number };

export type OperationStatus = "idle" | "running" | "success" | "error";

export type FileResult = { output: string; bytes: number };
export type PagedFileResult = FileResult & { pageCount: number };
export type TablesResult = FileResult & { tableCount: number; textPages: number[]; textlessPages: number[] };
export type DocxParams = PdfSourceParams & { headerFooter?: boolean };
export type DocxResult = FileResult & { skippedPages: number[]; textlessPages: number[]; headerLines: number; footerLines: number };
export type ImagesResult = { outputs: string[]; bytes: number; reducedPages: number[]; pageCount: number };

export type PdfSourceParams = { path: string; password?: string; output: string; overwrite?: boolean; pages?: string };
export type TextSourceParams = PdfSourceParams & { ocr?: boolean; ocrLanguages?: string[] };
export type TextParams = TextSourceParams & { layout?: boolean };
export type PptxMode = "editable" | "image";
export type PptxParams = PdfSourceParams & { dpi?: number; mode?: PptxMode };
export type TextFileResult = FileResult & { textlessPages: number[]; ocrPages: number[] };
export type MarkdownPictures = "none" | "files" | "embed";
export type MarkdownParams = TextSourceParams & { pictures?: MarkdownPictures };
export type MarkdownResult = TextFileResult & { pictureCount: number; pictureFolder: string | null };
export type XlsxSheets = "table" | "page" | "single";
export type XlsxFormat = "xlsx" | "csv";
export type XlsxParams = PdfSourceParams & { sheets?: XlsxSheets; format?: XlsxFormat; borderless?: boolean; pageLabel?: string; tableLabel?: string; textLabel?: string };
export type ImageFit = "fit" | "fill";
export type ImageFormat = "png" | "jpg" | "webp" | "tiff";
export type ImagesParams = {
  path: string;
  password?: string;
  outputDir: string;
  format: ImageFormat;
  dpi: number;
  quality?: number;
  pages?: string;
  baseName?: string;
  overwrite?: boolean;
  single?: boolean;
  transparent?: boolean;
  gray?: boolean;
  archive?: boolean;
};
export type ImagesToPdfParams = {
  images: string[];
  folders: string[];
  recursive?: boolean;
  sort?: "name" | "date";
  pageSize: "image" | "a4" | "letter";
  orientation?: "auto" | "portrait" | "landscape";
  margin?: number;
  fit?: ImageFit;
  output: string;
  overwrite?: boolean;
};
export type ImagesToPdfResult = OutputResult & { skipped: string[] };
export type MailLabels = { sender: string; to: string; cc: string; date: string; attachments: string };
export type FileToPdfParams = { path: string; output: string; overwrite?: boolean; paper?: "a4" | "letter"; mailLabels?: MailLabels };
export type CreateTemplate = "report" | "letter" | "petition" | "assignment" | "minutes" | "lectureNotes" | "booklet";
export type CreateFont = "sans" | "serif" | "mono";
export type BulkKind = "certificate" | "invitation" | "badge";
export type BulkSigner = { name: string; role: string };
export type CreateBulkParams = {
  dataPath: string;
  sheet?: string;
  delimiter?: CsvDelimiter;
  kind: BulkKind;
  heading?: string;
  recipient?: string;
  body?: string;
  details?: string;
  signers?: BulkSigner[];
  font?: CreateFont;
  accent?: string;
  logo?: string;
  split?: boolean;
  output?: string;
  outputDir?: string;
  pattern?: string;
  overwrite?: boolean;
};
export type CreateBulkResult = { outputs: string[]; count: number; pageCount: number; bytes: number };
export type CreatePaperSize = "a4" | "a5" | "a3" | "letter";
export type ClipboardKind = "files" | "image" | "html" | "text";
export type ClipboardParams = { output: string; overwrite?: boolean; paper?: "a4" | "letter" };
export type ClipboardResult = { kind: ClipboardKind; output: string | null; pageCount: number; bytes: number; files: string[] };
export type CoverStyle = "classic" | "band" | "frame" | "minimal" | "photo";
export type CoverParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  style: CoverStyle;
  title: string;
  subtitle?: string;
  author?: string;
  organisation?: string;
  date?: string;
  details?: string;
  logo?: string;
  image?: string;
  accent?: string;
  font?: CreateFont;
  replaceFirst?: boolean;
};
export type BookPaper = "a4" | "a5" | "b5" | "letter";
export type CreateBookParams = {
  chapters: string[];
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  cover: boolean;
  coverStyle?: CoverStyle;
  coverImage?: string;
  toc: boolean;
  tocTitle?: string;
  tocDepth?: 1 | 2;
  chapterLabel?: string;
  runningHeader?: boolean;
  pageNumbers?: boolean;
  font?: CreateFont;
  fontSize?: number;
  marginMm?: number;
  accent?: string;
  paper?: BookPaper;
  output: string;
  overwrite?: boolean;
};
export type CreatePaperParams = { size: CreatePaperSize; landscape: boolean; pages: number; pattern?: PaperPattern; output: string; overwrite?: boolean };
export type CreateDocumentParams = {
  path?: string;
  text?: string;
  format?: "auto" | "plain" | "markdown";
  template: CreateTemplate;
  title?: string;
  author?: string;
  date?: string;
  font?: CreateFont;
  fontSize?: number;
  marginMm?: number;
  accent?: string;
  logo?: string;
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
  pageNumberFormat?: string;
  paper?: "a4" | "letter" | "a5";
  output: string;
  overwrite?: boolean;
};
export type SvgToPdfParams = { paths: string[]; output: string; overwrite?: boolean };
export type EpubParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  split?: "auto" | "chapter" | "page";
  includeImages?: boolean;
  language?: string;
  title?: string;
  author?: string;
  cover?: boolean;
  ocr?: boolean;
  ocrLanguages?: string[];
};
export type EpubResult = { output: string; bytes: number; chapters: number; images: number; pageCount: number; cover: boolean; textlessPages: number[]; ocrPages: number[] };
export type WebPageParams = {
  url: string;
  output: string;
  overwrite?: boolean;
  paper?: "a4" | "letter";
  readerMode?: boolean;
  includeImages?: boolean;
};
export type WebPageResult = OutputResult & { title: string | null; sourceUrl: string; images: number };
export type ToolsStatus = { libreoffice: string | null; ocrLanguages: string[] };

export type OcrParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  languages: string[];
  dpi: number;
  mode: "skip_text" | "force" | "redo";
  orientation?: boolean;
  pages?: string;
  clean?: boolean;
  textOutput?: string;
};
export type OcrResult = OutputResult & { ocrPages: number; skippedPages: number; rotatedPages: number; words?: number; redonePages?: number; textOutput?: string | null };
export type OcrAreaParams = { path: string; password?: string; page: number; rect: number[]; languages?: string[]; dpi?: number };
export type OcrAreaLine = { text: string; x0: number; y0: number; x1: number; y1: number };
export type OcrAreaResult = { text: string; lines: OcrAreaLine[]; recognized: boolean };
export type OcrSearchableParams = { path: string; password?: string; pages?: string; languages?: string[]; dpi?: number; force?: boolean };
export type OcrSearchableResult = { pages: number; skipped: number; words: number; bytes: number };

export type ListPdfsParams = { folder: string; recursive?: boolean; limit?: number; exclude?: string[] };
export type PdfEntry = { path: string; size: number; modified: number };
export type ListPdfsResult = { files: string[]; entries: PdfEntry[]; truncated: boolean };
export type MoveToFolderParams = { path: string; folder: string };
export type MoveToFolderResult = { output: string };
export type RepairParams = { path: string; password?: string; output: string; overwrite?: boolean };
export type RepairResult = OutputResult & {
  wasRepaired: boolean;
  xrefCount: number;
  damagedPages: number;
  emptyPages: number;
  droppedPages: number;
  rebuilt: boolean;
  signed: boolean;
  recoveredBy: RepairEngine;
  issues: RepairIssue[];
  issuesTruncated: boolean;
};
export type RepairEngine = "mupdf" | "qpdf" | "scavenged";
export type RepairIssueKind = "damaged" | "empty" | "dropped";
export type RepairIssue = { page: number; kind: RepairIssueKind };

export type NumberStyle = "arabic" | "romanLower" | "romanUpper" | "letterLower" | "letterUpper";
export type TextPosition = GridPosition;
export type PageNumberParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  position: TextPosition;
  template: string;
  start: number;
  fontSize: number;
  margin: number;
  color: string;
  bold: boolean;
  prefix?: string;
  padding?: number;
  fontId?: string;
  suffix?: string;
  style?: NumberStyle;
  side?: PageSide;
  mirrorMargins?: boolean;
  pageLabels?: boolean;
  replaceExisting?: boolean;
};
export type HeaderFooterParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  fontSize: number;
  margin: number;
  color: string;
  bold?: boolean;
  fontId?: string;
  dateFormat?: string;
  start?: number;
  replaceExisting?: boolean;
};
export type FurnitureScope = "vivepdf" | "all";
export type RemoveHeaderFooterParams = { path: string; password?: string; output: string; overwrite?: boolean; pages?: string; scope?: FurnitureScope };
export type RemoveHeaderFooterResult = OutputResult & { removed: number; pagesChanged: number };
export type LetterheadTemplateRole = "template" | "firstPageTemplate";
export type StampedResult = OutputResult & { stamped: number; missingGlyphs?: string };
export type FlattenImageFormat = "auto" | "jpeg" | "png";
export type FlattenParams = { path: string; password?: string; output: string; overwrite?: boolean; annotations: boolean; forms: boolean; keepLinks?: boolean; rasterize?: boolean; dpi?: number; imageFormat?: FlattenImageFormat; jpegQuality?: number; printedOnly?: boolean };
export type FlattenResult = OutputResult & { fields: number; annotations: number; signatures: number; hiddenAnnotations: number; xfa: boolean };
export const REDACT_PRESETS = ["apiKey", "privateKey", "jwt", "connectionString", "password", "card", "iban", "crypto", "tckn", "taxNumber", "passport", "plate", "ssn", "email", "phone", "ip", "mac", "date"] as const;
export type RedactPreset = (typeof REDACT_PRESETS)[number];
export type RedactArea = { page: number; x0: number; y0: number; x1: number; y1: number };
export type RedactParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  areas?: RedactArea[];
  searchText: string[];
  patterns: string[];
  presets: RedactPreset[];
  caseSensitive: boolean;
  fill: string;
  overlayText?: string;
  overlaySize?: number;
  images: "none" | "overlapping" | "all";
  graphics?: "touched" | "contained";
  wholePages?: string;
  scrubHidden?: boolean;
  wholeWord?: boolean;
};
export type RedactResult = OutputResult & { redactions: number; hidden: number; imagesKept?: number };
export type RedactPreviewParams = {
  path: string;
  password?: string;
  searchText: string[];
  patterns: string[];
  presets: RedactPreset[];
  caseSensitive: boolean;
  pages?: string;
  wholeWord?: boolean;
};
export type SearchHit = { page: number; text: string; x0: number; y0: number; x1: number; y1: number };
export type RedactPreviewResult = { hits: SearchHit[] };
export type ScanPresetsParams = { path: string; password?: string; pages?: string };
export type ScanPresetsResult = { counts: Partial<Record<RedactPreset, number>>; pagesScanned: number; pageCount: number; pagesSelected?: number; complete?: boolean };
export type CropMode = "insets" | "auto";
export type CropParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  pages?: string;
  side?: PageSide;
  insets?: { left: number; top: number; right: number; bottom: number };
  mode?: CropMode;
  autoMargin?: number;
  removeContent?: boolean;
};
export type CropResult = OutputResult & { cropped: number };
export type ResizeMode = "fit" | "fill" | "stretch" | "box";
export type ResizeParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  preset?: string;
  width?: number;
  height?: number;
  pages?: string;
  autoRotate?: boolean;
  mode?: ResizeMode;
  margin?: number;
  matchLargest?: boolean;
};

export type SignParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  certificatePath: string;
  certificatePassword: string;
  page: number;
  box?: number[];
  visible: boolean;
  reason: string;
  location: string;
  contact: string;
  fieldName?: string;
  stampText?: string;
  certify?: boolean;
  certifyPermission?: CertifyPermission;
  lock?: boolean;
  existingField?: string;
  imagePath?: string;
  imageBase64?: string;
  timestampUrl?: string;
};
export type CertifyPermission = "none" | "forms" | "annotations";
export type SignResult = OutputResult & { signer: string };
export type SignatureFieldInfo = { name: string; page: number; signed: boolean };
export type SignatureFieldsResult = { fields: SignatureFieldInfo[]; certification: CertifyPermission | null; locked: boolean };
export type TrustProblem =
  | "selfSigned"
  | "noChain"
  | "notForSigning"
  | "expired"
  | "notYetValid"
  | "revoked"
  | "revocationUnknown"
  | "weakAlgorithm"
  | "other";
export type SignatureInfo = {
  fieldName: string;
  signer: string;
  signedAt: string | null;
  intact: boolean;
  valid: boolean;
  trusted: boolean;
  trustSource: "bundled" | "user" | "none";
  trustProblem?: TrustProblem | null;
  revoked: boolean | null;
  coverage: string;
  modificationLevel: string | null;
  reason: string | null;
  location: string | null;
  summary: string;
  modified: boolean;
  certified: boolean;
  permission: CertifyPermission | null;
};
export type VerifyResult = { signatures: SignatureInfo[] };
export type SignaturesPresentResult = { count: number };
export type TrustVerification = "verified" | "unpinned" | "pinMismatch" | "unsigned" | "unverifiable";
export type TrustSource = {
  kind: "euTrustedList" | "euListOfLists" | "securitySettings";
  territory: string | null;
  name: string | null;
  verification?: TrustVerification | null;
};
export type TrustListSigner = { subject: string; issuer: string; fingerprint: string; validFrom: string; validUntil: string; expired: boolean };
export type TrustListSignature = {
  status: TrustVerification;
  signer: TrustListSigner | null;
  signedAt: string | null;
  stale: boolean;
  nextUpdate: string | null;
};
export type TrustRoot = {
  id: string;
  subject: string;
  issuer: string;
  fingerprint: string;
  validFrom: string;
  validUntil: string;
  authority: boolean;
  selfSigned: boolean;
  expired: boolean;
  lists: TrustSource[];
};
export type TrustListResult = { roots: TrustRoot[]; unreadable: string[] };
export type TrustPreviewResult = {
  source: TrustSource | null;
  added: TrustRoot[];
  known: number;
  withdrawn: TrustRoot[];
  signature: TrustListSignature | null;
  digest: string;
  pinned: number;
};
export type TrustAddParams = { path: string; expectedDigest?: string; acceptUnverified?: boolean };
export type TrustAddResult = { added: TrustRoot[]; known: number; withdrawn: number; pinned: number };
export type TrustRemoveResult = { removed: number };
export type TrustClearResult = { removed: number };
export type CreateCertificateParams = {
  output: string;
  overwrite?: boolean;
  replaceKey?: boolean;
  password: string;
  commonName: string;
  email: string;
  organization: string;
  country: string;
  validDays: number;
  keyType: "rsa" | "ec";
  usage?: CertificateUsage;
};
export type CertificateUsage = "signing" | "encryption" | "both";
export type CreateCertificateResult = { output: string; bytes: number; subject: string; validUntil: string };
export type ExportCertificateParams = { path: string; password?: string; output: string; overwrite?: boolean };
export type ExportCertificateResult = { output: string; bytes: number; subject: string; validUntil: string };

export type FormFieldKind = "text" | "checkbox" | "radio" | "combobox" | "listbox" | "button" | "signature" | "other";
export type FormField = {
  name: string;
  kind: FormFieldKind;
  page: number;
  value: string | boolean | string[] | null;
  options: string[];
  label: string | null;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  rect: number[];
  multiSelect?: boolean;
  optionLabels?: string[];
  maxLength?: number | null;
  editable?: boolean;
  visibleRect?: number[];
  widgets?: { page: number; visibleRect: number[]; state: string | null }[];
};
export type FieldBox = { name: string; page: number; left: number; top: number; width: number; height: number };
export type FieldsResult = { fields: FormField[]; isForm: boolean; xfa: boolean; signed?: boolean; boxes: FieldBox[] };
export type FillParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; values: Record<string, string | boolean | string[]>; flatten: boolean; language?: string };
export type FillResult = OutputResult & {
  filled: number;
  recalculated?: number;
  calcSkipped?: number;
  truncated?: string[];
  missingGlyphs?: string[];
  xfaRemoved?: boolean;
  signaturesKept?: boolean;
};

export type CompareParams = {
  pathA: string;
  passwordA?: string;
  pathB: string;
  passwordB?: string;
  output?: string;
  overwrite?: boolean;
  visual?: boolean;
  text?: boolean;
  renderDpi?: number;
  ignoreCase?: boolean;
  ignorePunctuation?: boolean;
  ignoreMargins?: boolean;
};
export type ChangeMark = { kind: "text" | "area"; box: [number, number, number, number] };
export type PageDiff = { page: number; pageA: number | null; pageB: number | null; inA: boolean; inB: boolean; addedWords: number; removedWords: number; changedArea: number; sizeChanged: boolean; snippets: string[]; marksA: ChangeMark[]; marksB: ChangeMark[] };
export type ComparePageImagesParams = { pathA: string; passwordA?: string; pathB: string; passwordB?: string; pageA?: number; pageB?: number; dpi?: number };
export type ComparePageImagesResult = { imageA: string | null; imageB: string | null; width: number; height: number };
export type CompareResult = { output: string | null; pagesA: number; pagesB: number; changedPages: number; addedWords: number; removedWords: number; reportSpreads: number; pages: PageDiff[] };

export type ImposeLayout = "2up" | "3up" | "4up" | "6up" | "8up" | "9up" | "12up" | "16up" | "booklet" | "custom";
export type ImposeArrangement = "rows" | "columns";
export type ImposeReading = "ltr" | "rtl";
export type ImposeBinding = "left" | "right";
export type ImposeDuplex = "both" | "front" | "back";
export type ImposeScale = "fit" | "original";
export type ImposeParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  layout: ImposeLayout;
  columns?: number;
  rows?: number;
  paper?: "a4" | "a3" | "letter" | "tabloid" | "auto";
  orientation?: "auto" | "portrait" | "landscape";
  margin?: number;
  gap?: number;
  gutter?: number;
  arrangement?: ImposeArrangement;
  reading?: ImposeReading;
  binding?: ImposeBinding;
  duplex?: ImposeDuplex;
  flipShortEdge?: boolean;
  creep?: number;
  scale?: ImposeScale;
  autoRotate?: boolean;
  border?: boolean;
  borderWidth?: number;
  guides?: boolean;
  pages?: string;
};
export type ImposeResult = OutputResult & { sheets: number };

export type PosterPaper = "a4" | "a3" | "letter" | "legal";
export type PosterOrientation = "auto" | "portrait" | "landscape";
export type PosterParams = {
  path: string;
  password?: string;
  output: string;
  overwrite?: boolean;
  paper?: PosterPaper;
  orientation?: PosterOrientation;
  columns?: number;
  rows?: number;
  margin?: number;
  overlap?: number;
  cutMarks?: boolean;
  labels?: boolean;
  pages?: string;
};
export type PosterResult = OutputResult & { sheets: number; scale: number };

export type BookmarkTarget = "page" | "web" | "file" | "launch" | "other";
export type BookmarkFit = "XYZ" | "Fit" | "FitH" | "FitV" | "FitR" | "FitB" | "FitBH" | "FitBV";
export type BookmarkItem = {
  level: number;
  title: string;
  page: number;
  left?: number | null;
  top?: number | null;
  zoom?: number | null;
  collapsed?: boolean;
  target?: BookmarkTarget;
  uri?: string | null;
  file?: string | null;
  fit?: BookmarkFit | null;
  fitArgs?: (number | null)[] | null;
  color?: string | null;
  bold?: boolean;
  italic?: boolean;
  source?: number | null;
};
export type BookmarksGetParams = { path: string; password?: string };
export type BookmarksGetResult = { items: BookmarkItem[] };
export type BookmarkAddParams = { path: string; password?: string; title: string; page: number; x?: number; y?: number };
export type BookmarkAddResult = OutputResult & { index: number };
export type BookmarksSetParams = { path: string; password?: string; output?: string; inPlace?: boolean; overwrite?: boolean; items: BookmarkItem[]; openPanel?: boolean };
export type BookmarksGenerateParams = { path: string; password?: string; output: string; overwrite?: boolean; mode?: "headings" | "everyPage"; maxLevels?: number; minFontSize?: number; every?: number; label?: string };
export type BookmarksExportParams = { path: string; password?: string; output: string; overwrite?: boolean };
export type BookmarksExportResult = { output: string; count: number };
export type BookmarksImportParams = { path: string; password?: string; output: string; overwrite?: boolean; dataPath: string; replace?: boolean };
export type BookmarksGenerateResult = OutputResult & { items: BookmarkItem[] };
export type BookmarksSuggestParams = { path: string; password?: string; mode?: "headings" | "everyPage"; maxLevels?: number; minFontSize?: number; every?: number; label?: string };
export type BookmarksParseParams = { path: string; password?: string; dataPath: string; replace?: boolean };

export type TextSpan = {
  id: string;
  text: string;
  bbox: [number, number, number, number];
  font: string;
  fontXref: number;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  opacity?: number;
};
export type TextSpansParams = { path: string; password?: string; page: number; visible?: boolean };
export type TextSpansResult = { width: number; height: number; spans: TextSpan[] };
export type CodeBlocksParams = { path: string; password?: string; page: number; rect?: [number, number, number, number]; visible?: boolean };
export type CodeBlock = {
  id: string;
  bbox: [number, number, number, number];
  lines: string[];
  text: string;
  language: string | null;
  font: string;
  size: number;
};
export type CodeBlocksResult = { width: number; height: number; blocks: CodeBlock[] };
export type TextEdit = {
  bbox: [number, number, number, number];
  text: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  font?: string;
  fontXref?: number;
  opacity?: number;
};
export type TextEditWarning = { code: string; detail?: string | null };
export type TextReplaceParams = { path: string; password?: string; output: string; overwrite?: boolean; page: number; edits: TextEdit[]; visible?: boolean };
export type TextReplaceResult = OutputResult & { replaced: number; warnings: TextEditWarning[] };

export type SessionSnapshot = {
  savedAt: number;
  route: string;
  documents: string[];
  activePath: string | null;
  tabGroups?: Array<{ name: string; color: string; collapsed: boolean; paths: string[] }>;
  organizer: {
    mainPath: string;
    tiles: Array<OrganizerTile>;
    sources: Array<Omit<OrganizerSource, "embedDocId" | "password">>;
    selected: string[];
    cuts?: string[];
    labels?: Record<string, { style: PageLabelStyle; prefix: string; firstNumber: number }>;
  } | null;
};
export type LayerChoice = { id: number; on: boolean };
export type LayerRow = { id: number | null; name: string; depth: number; kind: "layer" | "label"; on: boolean; locked: boolean };
export type LayersListResult = { layers: LayerRow[] };
export type ViewSourceParams = { path: string; password?: string };
export type ViewPrepareParams = ViewSourceParams & { layers?: LayerChoice[] };
export type ScrubArea = { page: number; x0: number; y0: number; x1: number; y1: number };
export type RedactedTextParams = { path: string; password?: string; areas: ScrubArea[] };
export type RedactedTextResult = { texts: string[] };
export type ScrubHiddenParams = { path: string; password?: string; texts: string[]; areas: ScrubArea[]; output?: string; overwrite?: boolean };
export type ScrubHiddenResult = OutputResult & { hidden: number };
export type ViewPrepareResult = { viewPath: string | null; renamed: number; fonts: number; layers?: number };
export type ViewRestoreResult = { restored: number };
export type PageLabelsParams = { path: string; password?: string };
export type PageLabelsResult = { labels: string[] | null; pageCount: number };
