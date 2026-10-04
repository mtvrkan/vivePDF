import i18n, { currentLocale } from "@/app/i18n";
import { rpc, type RpcCallOptions } from "./client";
import type {
  OmrExportParams,
  OmrExportResult,
  OmrReadParams,
  OmrReadResult,
  OmrReviewParams,
  OmrSheetParams,
  OmrSheetResult,
  AutoLinkParams,
  PagesParams,
  RotatePagesParams,
  AutoLinkResult,
  PdfaCheckParams,
  PdfaConvertParams,
  PdfaConvertResult,
  PdfaLevel,
  PdfaReport,
  PdfaValidateResult,
  PdfaValidatorResult,
  PosterParams,
  PosterResult,
  RedactedTextParams,
  FontFileResult,
  RedactedTextResult,
  ScrubHiddenParams,
  ScrubHiddenResult,
  LayersListResult,
  ViewPrepareParams,
  ViewSourceParams,
  ViewPrepareResult,
  ViewRestoreResult,
  AccessFigurePreviewParams,
  AccessFigurePreviewResult,
  AccessFixParams,
  AccessFixResult,
  AccessReport,
  AssembleParams,
  AssemblePartsParams,
  AssemblePartsResult,
  AttachmentsChangedResult,
  AttachmentsExtractResult,
  AttachmentsListResult,
  AutoRotateParams,
  AutoRotateResult,
  BookmarksExportParams,
  BookmarksExportResult,
  BookmarksGenerateParams,
  BookmarksImportParams,
  BookmarksGenerateResult,
  BookmarksGetParams,
  BookmarksGetResult,
  BookmarksParseParams,
  BookmarksSetParams,
  BookmarkAddParams,
  BookmarkAddResult,
  BookmarksSuggestParams,
  CodeBlocksParams,
  CodeBlocksResult,
  CodesExportParams,
  CodesExportResult,
  CodesReadParams,
  CodesReadResult,
  CommentsExportParams,
  CommentsExportResult,
  CommentsImportParams,
  CommentsImportResult,
  CommentsListResult,
  CompareParams,
  CompareResult,
  ComparePageImagesParams,
  ComparePageImagesResult,
  CompressParams,
  CompressPreviewParams,
  CompressPreviewResult,
  CompressResult,
  SpaceReport,
  CreateCertificateParams,
  CreateCertificateResult,
  ExportCertificateParams,
  ExportCertificateResult,
  CropParams,
  CropResult,
  DataPreviewParams,
  DataPreviewResult,
  DecryptParams,
  DetectRotationParams,
  DetectRotationResult,
  DetectWatermarkResult,
  DocxParams,
  DocxResult,
  EditorApplyParams,
  EditorApplyResult,
  EditorBlocksResult,
  EditorFontPlanParams,
  EditorFontResolution,
  EditorFontResult,
  EditorSystemFontsResult,
  DecryptCertificateParams,
  EncryptCertificateParams,
  EncryptCertificateResult,
  EncryptResult,
  EncryptParams,
  EpubParams,
  EpubResult,
  ExtractImagesParams,
  ExtractImagesResult,
  FieldsResult,
  FileToPdfParams,
  CreateDocumentParams,
  CreateBulkParams,
  CreateBulkResult,
  CreateBookParams,
  CreatePaperParams,
  CoverParams,
  ClipboardParams,
  ClipboardResult,
  MailLabels,
  SvgToPdfParams,
  FillParams,
  FillResult,
  FindPreviewParams,
  FindPreviewResult,
  FindReplaceParams,
  FindReplaceResult,
  FlattenParams,
  FlattenResult,
  FontCatalogueResult,
  FontChoice,
  FontLibraryFamily,
  FontRemoveResult,
  FormDetectParams,
  FormDataExportParams,
  FormDataExportResult,
  FormDataImportParams,
  FormDataImportResult,
  FormDetectResult,
  FormExportParams,
  FormExportResult,
  FormMergeParams,
  FormMergeResult,
  HeaderFooterParams,
  RemoveHeaderFooterParams,
  RemoveHeaderFooterResult,
  StampedResult,
  ImageAtResult,
  ImagePreviewResult,
  TablePreviewResult,
  ChartPreviewResult,
  ChartSpec,
  QuestionPreviewResult,
  QuestionSpec,
  FlowchartPreviewResult,
  FlowchartSpec,
  TableSpec,
  ImageSaveResult,
  ImagesParams,
  ImagesResult,
  ImagesToPdfParams,
  ImagesToPdfResult,
  ImposeParams,
  ImposeResult,
  InsertFromParams,
  InsertFromResult,
  LetterheadParams,
  LetterheadResult,
  LinksAddParams,
  LinksChangedResult,
  LinksListResult,
  LinksRemoveParams,
  MarkPreviewResult,
  MergeParams,
  MergeResult,
  OcrAreaParams,
  OcrAreaResult,
  OcrParams,
  OcrResult,
  OcrSearchableParams,
  OcrSearchableResult,
  OutputResult,
  PagedFileResult,
  PageNumberParams,
  PageTextResult,
  PageTonesResult,
  PptxParams,
  PreflightProfile,
  PreflightReport,
  PrintersResult,
  PrintRunParams,
  PrintRunResult,
  PrivacyReport,
  QrAddParams,
  QrAddResult,
  RedactParams,
  RedactPreviewParams,
  RedactPreviewResult,
  RedactResult,
  RemoveWatermarkParams,
  RemoveWatermarkResult,
  ReviewState,
  RenameApplyParams,
  RenameApplyResult,
  RenamePreviewParams,
  RenamePreviewResult,
  RenameUndoParams,
  RenameUndoResult,
  ListPdfsParams,
  ListPdfsResult,
  MoveToFolderParams,
  MoveToFolderResult,
  RepairParams,
  RepairResult,
  ResizeParams,
  SanitizeParams,
  SanitizeResult,
  ScanEnhanceParams,
  ScanEnhanceResult,
  ScannerAcquireParams,
  ScannerAcquireResult,
  ScannerAssembleParams,
  ScannerAssembleResult,
  ScannerDiscardResult,
  ScannerDevicesResult,
  ScanPhotoDetectParams,
  ScanPhotoDetectResult,
  ScanPhotoParams,
  ScanPhotoResult,
  ScanPresetsParams,
  ScanPresetsResult,
  ScanSplitParams,
  ScanSplitPreviewResult,
  ScanEnhancePreviewParams,
  SeparatorSheetParams,
  SeparatorSheetResult,
  ScanEnhancePreviewResult,
  ScanSplitRules,
  ScanSplitResult,
  SearchFoldersResult,
  SearchIndexResult,
  SearchQueryParams,
  SearchQueryResult,
  SearchStatsResult,
  SetMetadataParams,
  SetMetadataResult,
  SignatureCleanResult,
  SignaturePlaceParams,
  SignaturePlaceResult,
  SignParams,
  SignResult,
  SignatureFieldsResult,
  SignaturesPresentResult,
  SplitParams,
  SplitResult,
  StampParams,
  StampPreviewParams,
  StampResult,
  TablesResult,
  TextFileResult,
  TextParams,
  TextSourceParams,
  MarkdownParams,
  MarkdownResult,
  TextReplaceParams,
  TextReplaceResult,
  TextSpansParams,
  TextSpansResult,
  ToolsStatus,
  TrustAddParams,
  TrustAddResult,
  TrustPreviewResult,
  TrustListResult,
  TrustRemoveResult,
  TrustClearResult,
  TranslateModelChangedResult,
  TranslateModelsResult,
  TranslateTextResult,
  TtsSynthesizeResult,
  TtsVoiceChangedResult,
  TtsVoicesResult,
  VerifyResult,
  WatermarkParams,
  WatermarkPreviewParams,
  WebPageParams,
  WebPageResult,
  XlsxParams,
} from "@/types";
import type {
  StudioDocument,
  StudioDocumentContent,
  StudioDocumentPage,
  StudioDocumentPreview,
  StudioDraftLoadResult,
  StudioDraftSaveParams,
  StudioDraftSaveResult,
  StudioImageInfo,
  StudioImportedSvg,
  StudioProjectOpenResult,
  StudioProjectSaveParams,
  StudioProjectSaveResult,
  StudioQrLevel,
  StudioQrModules,
  StudioRenderParams,
  StudioRenderResult,
  StudioSavedImage,
  StudioThumbnailParams,
  StudioThumbnailResult,
} from "@/types/studio";

export const assemblePages = (params: AssembleParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("pages.assemble", params, options);

export const assemblePageParts = (params: AssemblePartsParams, options?: RpcCallOptions) =>
  rpc<AssemblePartsResult>("pages.assemble_parts", params, options);

const mailLabels = (): MailLabels => ({
  sender: i18n.t("mail.sender"),
  to: i18n.t("mail.to"),
  cc: i18n.t("mail.cc"),
  date: i18n.t("mail.date"),
  attachments: i18n.t("mail.attachments"),
});

export const mergePdfs = (params: MergeParams, options?: RpcCallOptions) =>
  rpc<MergeResult>("pages.merge", { mailLabels: mailLabels(), ...params }, options);

export const rotatePages = (params: RotatePagesParams, options?: RpcCallOptions) => rpc<OutputResult>("pages.rotate", params, options);

export const deletePages = (params: PagesParams, options?: RpcCallOptions) => rpc<OutputResult>("pages.delete", params, options);

export const extractPages = (params: PagesParams, options?: RpcCallOptions) => rpc<OutputResult>("pages.extract", params, options);

export const splitPdf = (params: SplitParams, options?: RpcCallOptions) =>
  rpc<SplitResult>("pages.split", params, options);

export const cropPages = (params: CropParams, options?: RpcCallOptions) =>
  rpc<CropResult>("pages.crop", params, options);

export const resizePages = (params: ResizeParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("pages.resize", params, options);

export const numberPages = (params: PageNumberParams, options?: RpcCallOptions) =>
  rpc<StampedResult>("pages.number", params, options);

export const headerFooter = (params: HeaderFooterParams, options?: RpcCallOptions) =>
  rpc<StampedResult>("pages.header_footer", params, options);

export const removeHeaderFooter = (params: RemoveHeaderFooterParams, options?: RpcCallOptions) =>
  rpc<RemoveHeaderFooterResult>("pages.remove_header_footer", params, options);

export const inspectSpace = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<SpaceReport>("compress.space", params, options);

export const compressPdf = (params: CompressParams, options?: RpcCallOptions) =>
  rpc<CompressResult>("compress.run", params, options);

export const previewCompress = (params: CompressPreviewParams, options?: RpcCallOptions) =>
  rpc<CompressPreviewResult>("compress.preview", params, options);

export const encryptPdf = (params: EncryptParams, options?: RpcCallOptions) =>
  rpc<EncryptResult>("security.encrypt", params, options);

export const encryptWithCertificate = (params: EncryptCertificateParams, options?: RpcCallOptions) =>
  rpc<EncryptCertificateResult>("security.encrypt_certificate", params, options);

export const decryptWithCertificate = (params: DecryptCertificateParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("security.decrypt_certificate", params, options);

export const decryptPdf = (params: DecryptParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("security.decrypt", params, options);

export const watermarkPdf = (params: WatermarkParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("security.watermark", params, options);

export const previewWatermark = (params: WatermarkPreviewParams, options?: RpcCallOptions) =>
  rpc<MarkPreviewResult>("security.watermark_preview", params, options);

export const removeWatermark = (params: RemoveWatermarkParams, options?: RpcCallOptions) =>
  rpc<RemoveWatermarkResult>("security.remove_watermark", params, options);

export const detectWatermark = (params: { path: string; password?: string; pages?: string }, options?: RpcCallOptions) =>
  rpc<DetectWatermarkResult>("security.detect_watermark", params, options);

export const flattenPdf = (params: FlattenParams, options?: RpcCallOptions) =>
  rpc<FlattenResult>("security.flatten", params, options);

export const redactPdf = (params: RedactParams, options?: RpcCallOptions) =>
  rpc<RedactResult>("security.redact", params, options);

export const redactPreview = (params: RedactPreviewParams, options?: RpcCallOptions) =>
  rpc<RedactPreviewResult>("security.redact_preview", params, options);

export const scanPresets = (params: ScanPresetsParams, options?: RpcCallOptions) =>
  rpc<ScanPresetsResult>("security.scan_presets", params, options);

export const fontCatalogue = (options?: RpcCallOptions) =>
  rpc<FontCatalogueResult>("fonts.catalogue", {}, options);

export const addFont = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<FontChoice>("fonts.add", params, options);

export const removeFont = (params: { id: string }, options?: RpcCallOptions) =>
  rpc<FontRemoveResult>("fonts.remove", params, options);

export const fontLibrary = (options?: RpcCallOptions) =>
  rpc<{ families: FontLibraryFamily[] }>("fonts.library", {}, options);

export const downloadLibraryFont = (params: { id: string }, options?: RpcCallOptions) =>
  rpc<FontLibraryFamily>("fonts.library_download", params, options);

export const removeLibraryFont = (params: { id: string }, options?: RpcCallOptions) =>
  rpc<FontLibraryFamily>("fonts.library_remove", params, options);

export const inspectPrivacy = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<PrivacyReport>("security.inspect", params, options);

export const sanitizePdf = (params: SanitizeParams, options?: RpcCallOptions) =>
  rpc<SanitizeResult>("security.sanitize", params, options);

export const enhanceScan = (params: ScanEnhanceParams, options?: RpcCallOptions) =>
  rpc<ScanEnhanceResult>("scan.enhance", params, options);

export const photoToPdf = (params: ScanPhotoParams, options?: RpcCallOptions) => rpc<ScanPhotoResult>("scan.from_photo", params, options);
export const detectPhotoPaper = (params: ScanPhotoDetectParams, options?: RpcCallOptions) => rpc<ScanPhotoDetectResult>("scan.photo_detect", params, options);
export const splitScans = (params: ScanSplitParams, options?: RpcCallOptions) =>
  rpc<ScanSplitResult>("scan.split", params, options);
export const previewScanSplit = (params: ScanSplitRules, options?: RpcCallOptions) =>
  rpc<ScanSplitPreviewResult>("scan.splitPreview", params, options);
export const createSeparatorSheets = (params: SeparatorSheetParams, options?: RpcCallOptions) =>
  rpc<SeparatorSheetResult>("scan.separatorSheet", params, options);
export const previewScanEnhance = (params: ScanEnhancePreviewParams, options?: RpcCallOptions) =>
  rpc<ScanEnhancePreviewResult>("scan.enhancePreview", params, options);

export const listScanners = (options?: RpcCallOptions) =>
  rpc<ScannerDevicesResult>("scanner.devices", {}, options);

export const acquireFromScanner = (params: ScannerAcquireParams, options?: RpcCallOptions) =>
  rpc<ScannerAcquireResult>("scanner.acquire", params, options);

export const assembleScanSession = (params: ScannerAssembleParams, options?: RpcCallOptions) =>
  rpc<ScannerAssembleResult>("scanner.assemble", params, options);

export const discardScanSession = (paths: string[], options?: RpcCallOptions) =>
  rpc<ScannerDiscardResult>("scanner.discard", { paths }, options);

export const previewRename = (params: RenamePreviewParams, options?: RpcCallOptions) =>
  rpc<RenamePreviewResult>("rename.preview", params, options);

export const applyRename = (params: RenameApplyParams, options?: RpcCallOptions) =>
  rpc<RenameApplyResult>("rename.apply", params, options);

export const undoRename = (params: RenameUndoParams, options?: RpcCallOptions) =>
  rpc<RenameUndoResult>("rename.undo", params, options);

export const searchFolders = () => rpc<SearchFoldersResult>("search.folders");

export const searchAddFolder = (params: { path: string; recursive?: boolean }, options?: RpcCallOptions) =>
  rpc<SearchIndexResult>("search.add_folder", params, options);

export const searchRemoveFolder = (params: { path: string }) => rpc<SearchFoldersResult>("search.remove_folder", params);

export const searchIndex = (params: { path?: string; force?: boolean }, options?: RpcCallOptions) =>
  rpc<SearchIndexResult>("search.index", params, options);

export const searchQuery = (params: SearchQueryParams, options?: RpcCallOptions) =>
  rpc<SearchQueryResult>("search.query", params, options);

export const searchClearAll = () => rpc<SearchFoldersResult>("search.clear_all");

export const searchStats = () => rpc<SearchStatsResult>("search.stats");

export const checkPreflight = (params: { path: string; password?: string; profile?: PreflightProfile }, options?: RpcCallOptions) =>
  rpc<PreflightReport>("preflight.check", params, options);
export const setMetadata = (params: SetMetadataParams, options?: RpcCallOptions) => rpc<SetMetadataResult>("info.set_metadata", params, options);
export const extractImages = (params: ExtractImagesParams, options?: RpcCallOptions) => rpc<ExtractImagesResult>("convert.extract_images", params, options);
export const detectRotation = (params: DetectRotationParams, options?: RpcCallOptions) => rpc<DetectRotationResult>("pages.detect_rotation", params, options);
export const autoRotatePages = (params: AutoRotateParams, options?: RpcCallOptions) => rpc<AutoRotateResult>("pages.auto_rotate", params, options);
export const applyLetterhead = (params: LetterheadParams, options?: RpcCallOptions) => rpc<LetterheadResult>("pages.letterhead", params, options);
export const findPreview = (params: FindPreviewParams, options?: RpcCallOptions) => rpc<FindPreviewResult>("textedit.find_preview", params, options);
export const findReplaceText = (params: FindReplaceParams, options?: RpcCallOptions) => rpc<FindReplaceResult>("textedit.find_replace", params, options);
export const listLinks = (params: { path: string; password?: string; page?: number }, options?: RpcCallOptions) => rpc<LinksListResult>("links.list", params, options);
export const addLinks = (params: LinksAddParams, options?: RpcCallOptions) => rpc<LinksChangedResult>("links.add", params, options);
export const removeLinks = (params: LinksRemoveParams, options?: RpcCallOptions) => rpc<LinksChangedResult>("links.remove", params, options);
export const autoLinkPdf = (params: AutoLinkParams, options?: RpcCallOptions) => rpc<AutoLinkResult>("links.autolink", params, options);
export const posterPages = (params: PosterParams, options?: RpcCallOptions) => rpc<PosterResult>("pages.poster", params, options);
export const checkPdfa = (params: PdfaCheckParams, options?: RpcCallOptions) => rpc<PdfaReport>("pdfa.check", params, options);
export const convertPdfa = (params: PdfaConvertParams, options?: RpcCallOptions) => rpc<PdfaConvertResult>("pdfa.convert", params, options);
export const pdfaValidator = (options?: RpcCallOptions) => rpc<PdfaValidatorResult>("pdfa.validator", {}, options);
export const validatePdfa = (params: { path: string; level: PdfaLevel }, options?: RpcCallOptions) => rpc<PdfaValidateResult>("pdfa.validate", params, options);
export const tablePreview = (params: TableSpec, options?: RpcCallOptions) => rpc<TablePreviewResult>("editor.table_preview", params, options);
export const chartPreview = (params: ChartSpec, options?: RpcCallOptions) => rpc<ChartPreviewResult>("editor.chart_preview", params, options);
export const flowchartPreview = (params: FlowchartSpec, options?: RpcCallOptions) => rpc<FlowchartPreviewResult>("editor.flowchart_preview", params, options);
export const questionPreview = (params: QuestionSpec, options?: RpcCallOptions) => rpc<QuestionPreviewResult>("editor.question_preview", params, options);
export const imagePreview = (params: { path: string }, options?: RpcCallOptions) => rpc<ImagePreviewResult>("editor.image_preview", params, options);
export const applyEditor = (params: EditorApplyParams, options?: RpcCallOptions) => rpc<EditorApplyResult>("editor.apply", params, options);
export const editorBlocks = (params: { path: string; password?: string; page: number }, options?: RpcCallOptions) => rpc<EditorBlocksResult>("editor.blocks", params, options);
export const editorFont = (params: { path: string; password?: string; xref: number }, options?: RpcCallOptions) => rpc<EditorFontResult>("editor.font", params, options);
export const fontFile = (params: { id: string; bold?: boolean; italic?: boolean; weight?: number }, options?: RpcCallOptions) => rpc<FontFileResult>("fonts.file", params, options);
export const editorFontPlan = (params: EditorFontPlanParams, options?: RpcCallOptions) => rpc<EditorFontResolution>("editor.font_plan", params, options);
export const editorSystemFonts = (options?: RpcCallOptions) => rpc<EditorSystemFontsResult>("editor.system_fonts", {}, options);
export const imageAt = (params: { path: string; password?: string; page: number; x: number; y: number; previewMaxSide?: number }, options?: RpcCallOptions) => rpc<ImageAtResult>("images.at", params, options);
export const listPrinters = (options?: RpcCallOptions) => rpc<PrintersResult>("print.printers", {}, options);
export const runPrint = (params: PrintRunParams, options?: RpcCallOptions) => rpc<PrintRunResult>("print.run", params, options);
export const imageSave = (params: { path: string; password?: string; page: number; x: number; y: number; output: string; overwrite?: boolean }, options?: RpcCallOptions) => rpc<ImageSaveResult>("images.save", params, options);
export const insertPagesFrom = (params: InsertFromParams, options?: RpcCallOptions) => rpc<InsertFromResult>("pages.insert_from", params, options);
export const ttsVoices = (options?: RpcCallOptions) => rpc<TtsVoicesResult>("tts.voices", {}, options);
export const ttsDownload = (id: string, options?: RpcCallOptions) => rpc<TtsVoiceChangedResult>("tts.download", { id }, options);
export const ttsRemove = (id: string, options?: RpcCallOptions) => rpc<TtsVoiceChangedResult>("tts.remove", { id }, options);
export const ttsImport = (path: string, options?: RpcCallOptions) => rpc<TtsVoiceChangedResult>("tts.import", { path }, options);
export const ttsSynthesize = (params: { voiceId: string; text: string; rate?: number; sentences?: boolean; speakerId?: number }, options?: RpcCallOptions) => rpc<TtsSynthesizeResult>("tts.synthesize", params, options);
export const translateModels = (options?: RpcCallOptions) => rpc<TranslateModelsResult>("translate.models", {}, options);
export const translateDownload = (id: string, options?: RpcCallOptions) => rpc<TranslateModelChangedResult>("translate.download", { id }, options);
export const translateImport = (path: string, options?: RpcCallOptions) => rpc<TranslateModelChangedResult>("translate.import", { path }, options);
export const translateRemove = (id: string, options?: RpcCallOptions) => rpc<TranslateModelChangedResult>("translate.remove", { id }, options);
export const translateText = (params: { text: string; source: string; target: string }, options?: RpcCallOptions) => rpc<TranslateTextResult>("translate.text", params, options);
export const cleanSignature = (params: { path: string; inkColor?: string }, options?: RpcCallOptions) =>
  rpc<SignatureCleanResult>("signature.clean", params, options);
export const placeSignature = (params: SignaturePlaceParams, options?: RpcCallOptions) => rpc<SignaturePlaceResult>("signature.place", params, options);
export const stampPdf = (params: StampParams, options?: RpcCallOptions) => rpc<StampResult>("security.stamp", params, options);
export const previewStamp = (params: StampPreviewParams, options?: RpcCallOptions) => rpc<MarkPreviewResult>("security.stamp_preview", params, options);
export const listAttachments = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<AttachmentsListResult>("attachments.list", params, options);
export const addAttachments = (params: { path: string; password?: string; files: string[]; description?: string }, options?: RpcCallOptions) =>
  rpc<AttachmentsChangedResult>("attachments.add", params, options);
export const removeAttachments = (params: { path: string; password?: string; names: string[] }, options?: RpcCallOptions) =>
  rpc<AttachmentsChangedResult>("attachments.remove", params, options);
export const extractAttachments = (params: { path: string; password?: string; names: string[]; outputDir: string }, options?: RpcCallOptions) =>
  rpc<AttachmentsExtractResult>("attachments.extract", params, options);
export const listComments = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<CommentsListResult>("comments.list", params, options);

export const setCommentsResolved = (params: { path: string; password?: string; xrefs: number[]; resolved: boolean; author?: string }) =>
  rpc<{ changed: number }>("comments.set_resolved", params);

export const setCommentsState = (params: { path: string; password?: string; xrefs: number[]; state: ReviewState | "None"; author?: string }) =>
  rpc<{ changed: number }>("comments.set_state", params);

export const replyToComment = (params: { path: string; password?: string; xref: number; content: string; author?: string }) =>
  rpc<{ xref: number }>("comments.reply", params);

export const deleteComments = (params: { path: string; password?: string; xrefs: number[] }) =>
  rpc<{ changed: number }>("comments.delete", params);

export const exportComments = (params: CommentsExportParams, options?: RpcCallOptions) =>
  rpc<CommentsExportResult>("comments.export", params, options);

export const importComments = (params: CommentsImportParams, options?: RpcCallOptions) =>
  rpc<CommentsImportResult>("comments.import", params, options);

export const getPageText = (params: { path: string; password?: string; pages?: string }, options?: RpcCallOptions) =>
  rpc<PageTextResult>("info.text", params, options);

export const getPageTones = (params: { path: string; password?: string; pages?: string }, options?: RpcCallOptions) =>
  rpc<PageTonesResult>("viewer.pageTones", params, options);

export const checkAccessibility = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<AccessReport>("a11y.check", params, options);

export const fixAccessibility = (params: AccessFixParams, options?: RpcCallOptions) => rpc<AccessFixResult>("a11y.fix", params, options);

export const previewAccessFigure = (params: AccessFigurePreviewParams, options?: RpcCallOptions) =>
  rpc<AccessFigurePreviewResult>("a11y.figurePreview", params, options);

export const previewFormData = (params: DataPreviewParams) => rpc<DataPreviewResult>("forms.data_preview", params);

export const mergeForms = (params: FormMergeParams, options?: RpcCallOptions) =>
  rpc<FormMergeResult>("forms.merge", { language: currentLocale(), ...params }, options);

export const exportForms = (params: FormExportParams, options?: RpcCallOptions) => rpc<FormExportResult>("forms.export", params, options);

export const detectFormFields = (params: FormDetectParams, options?: RpcCallOptions) =>
  rpc<FormDetectResult>("forms.detect", params, options);

export const exportFormData = (params: FormDataExportParams, options?: RpcCallOptions) =>
  rpc<FormDataExportResult>("forms.export_data", params, options);

export const importFormData = (params: FormDataImportParams, options?: RpcCallOptions) =>
  rpc<FormDataImportResult>("forms.import_data", { language: currentLocale(), ...params }, options);

export const createOmrSheets = (params: OmrSheetParams, options?: RpcCallOptions) => rpc<OmrSheetResult>("omr.sheet", params, options);
export const readOmrSheets = (params: OmrReadParams, options?: RpcCallOptions) => rpc<OmrReadResult>("omr.read", params, options);
export const reviewOmrSheets = (params: OmrReviewParams, options?: RpcCallOptions) => rpc<OmrSheetResult>("omr.review", params, options);
export const exportOmrResults = (params: OmrExportParams, options?: RpcCallOptions) => rpc<OmrExportResult>("omr.export", params, options);

export const readCodes = (params: CodesReadParams, options?: RpcCallOptions) =>
  rpc<CodesReadResult>("codes.read", params, options);

export const exportCodesCsv = (params: CodesExportParams, options?: RpcCallOptions) =>
  rpc<CodesExportResult>("codes.export_csv", params, options);

export const addQrCodes = (params: QrAddParams, options?: RpcCallOptions) =>
  rpc<QrAddResult>("codes.add_qr", params, options);

export const repairPdf = (params: RepairParams, options?: RpcCallOptions) =>
  rpc<RepairResult>("repair.run", params, options);

export const listPdfs = (params: ListPdfsParams, options?: RpcCallOptions) =>
  rpc<ListPdfsResult>("files.list_pdfs", params, options);

export const moveToFolder = (params: MoveToFolderParams, options?: RpcCallOptions) =>
  rpc<MoveToFolderResult>("files.move_to_folder", params, options);

export const runOcr = (params: OcrParams, options?: RpcCallOptions) =>
  rpc<OcrResult>("ocr.run", params, options);

export const ocrArea = (params: OcrAreaParams, options?: RpcCallOptions) =>
  rpc<OcrAreaResult>("ocr.area", params, options);

export const ocrSearchable = (params: OcrSearchableParams, options?: RpcCallOptions) =>
  rpc<OcrSearchableResult>("ocr.searchable", params, options);

export const toolsStatus = () => rpc<ToolsStatus>("convert.tools");

export const convertToDocx = (params: DocxParams, options?: RpcCallOptions) =>
  rpc<DocxResult>("convert.to_docx", params, options);

export const convertToXlsx = (params: XlsxParams, options?: RpcCallOptions) =>
  rpc<TablesResult>("convert.to_xlsx", params, options);

export const convertToPptx = (params: PptxParams, options?: RpcCallOptions) =>
  rpc<PagedFileResult>("convert.to_pptx", params, options);

export const convertToImages = (params: ImagesParams, options?: RpcCallOptions) =>
  rpc<ImagesResult>("convert.to_images", params, options);

export const convertToText = (params: TextParams, options?: RpcCallOptions) =>
  rpc<TextFileResult>("convert.to_text", params, options);

export const convertToMarkdown = (params: MarkdownParams, options?: RpcCallOptions) =>
  rpc<MarkdownResult>("convert.to_markdown", params, options);

export const convertToHtml = (params: TextSourceParams, options?: RpcCallOptions) =>
  rpc<TextFileResult>("convert.to_html", params, options);


export const imagesToPdf = (params: ImagesToPdfParams, options?: RpcCallOptions) =>
  rpc<ImagesToPdfResult>("convert.images_to_pdf", params, options);

export const fileToPdf = (params: FileToPdfParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("convert.file_to_pdf", { mailLabels: mailLabels(), ...params }, options);

export const createDocument = (params: CreateDocumentParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("create.document", params, options);

export const createBulk = (params: CreateBulkParams, options?: RpcCallOptions) =>
  rpc<CreateBulkResult>("create.bulk", params, options);

export const createBook = (params: CreateBookParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("create.book", params, options);

export const studioRender = (params: StudioRenderParams, options?: RpcCallOptions) =>
  rpc<StudioRenderResult>("studio.render", params, options);

export const studioImageInfo = (params: { path: string; maxSide?: number }, options?: RpcCallOptions) =>
  rpc<StudioImageInfo>("studio.image_info", params, options);

export const studioSaveImage = (params: { data: string }, options?: RpcCallOptions) =>
  rpc<StudioSavedImage>("studio.save_image", params, options);

export const studioImportSvg = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<StudioImportedSvg>("studio.import_svg", params, options);

export const studioQr = (params: { value: string; errorLevel: StudioQrLevel }, options?: RpcCallOptions) =>
  rpc<StudioQrModules>("studio.qr", params, options);

export const studioSaveProject = (params: StudioProjectSaveParams, options?: RpcCallOptions) =>
  rpc<StudioProjectSaveResult>("studio.save_project", params, options);

export const studioThumbnail = (params: StudioThumbnailParams, options?: RpcCallOptions) =>
  rpc<StudioThumbnailResult>("studio.thumbnail", params, options);

export const studioOpenProject = (params: { path: string; password?: string | null }, options?: RpcCallOptions) =>
  rpc<StudioProjectOpenResult>("studio.open_project", params, options);

export const studioSaveDraft = (params: StudioDraftSaveParams, options?: RpcCallOptions) =>
  rpc<StudioDraftSaveResult>("studio.save_draft", params, options);

export const studioLoadDraft = (options?: RpcCallOptions) => rpc<StudioDraftLoadResult>("studio.load_draft", {}, options);

export const studioRenderDocument =(params: StudioDocumentContent & { output: string; overwrite?: boolean }, options?: RpcCallOptions) =>
  rpc<OutputResult>("studio.render_document", params, options);

export const studioPreviewDocument = (params: StudioDocumentContent, options?: RpcCallOptions) =>
  rpc<StudioDocumentPreview>("studio.preview_document", params, options);

export const studioPreviewDocumentPage = (params: { token: string; page: number; width: number }, options?: RpcCallOptions) =>
  rpc<StudioDocumentPage>("studio.preview_document_page", params, options);

export const studioSaveDocument = (params: { document: StudioDocument; output: string; overwrite?: boolean }, options?: RpcCallOptions) =>
  rpc<{ output: string; bytes: number }>("studio.save_document", params, options);

export const studioOpenDocument = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<{ document: unknown }>("studio.open_document", params, options);

export const studioImportDocument = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<{ html: string; title: string }>("studio.import_document", params, options);

export const studioDocumentImage = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<{ src: string; width: number; height: number }>("studio.document_image", params, options);

export const studioDesignOf = (params: { path: string; password?: string | null }, options?: RpcCallOptions) =>
  rpc<{ found: boolean }>("studio.design_of", params, options);

export const createPaper = (params: CreatePaperParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("create.paper", params, options);

export const clipboardToPdf = (params: ClipboardParams, options?: RpcCallOptions) =>
  rpc<ClipboardResult>("create.clipboard", params, options);

export const addCover = (params: CoverParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("pages.cover", params, options);

export const svgToPdf = (params: SvgToPdfParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("convert.svg_to_pdf", params, options);

export const urlToPdf = (params: WebPageParams, options?: RpcCallOptions) =>
  rpc<WebPageResult>("convert.from_url", params, options);

export const convertToEpub = (params: EpubParams, options?: RpcCallOptions) =>
  rpc<EpubResult>("convert.to_epub", params, options);

export const signPdf = (params: SignParams, options?: RpcCallOptions) =>
  rpc<SignResult>("sign.run", params, options);

export const verifySignatures = (params: { path: string; password?: string; online?: boolean }, options?: RpcCallOptions) =>
  rpc<VerifyResult>("sign.verify", params, options);

export const countSignatures = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<SignaturesPresentResult>("sign.count", params, options);

export const listTrustRoots = (options?: RpcCallOptions) => rpc<TrustListResult>("sign.trust_list", {}, options);

export const previewTrustRoots = (params: { path: string }, options?: RpcCallOptions) =>
  rpc<TrustPreviewResult>("sign.trust_preview", params, options);

export const addTrustRoot = (params: TrustAddParams, options?: RpcCallOptions) =>
  rpc<TrustAddResult>("sign.trust_add", params, options);

export const removeTrustRoot = (params: { id: string }, options?: RpcCallOptions) =>
  rpc<TrustRemoveResult>("sign.trust_remove", params, options);

export const clearTrustRoots = (options?: RpcCallOptions) => rpc<TrustClearResult>("sign.trust_clear", {}, options);

export const listSignatureFields = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<SignatureFieldsResult>("sign.fields", params, options);

export const createCertificate = (params: CreateCertificateParams, options?: RpcCallOptions) =>
  rpc<CreateCertificateResult>("sign.create_certificate", params, options);

export const exportCertificate = (params: ExportCertificateParams, options?: RpcCallOptions) =>
  rpc<ExportCertificateResult>("sign.export_certificate", params, options);

export const listFormFields = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<FieldsResult>("forms.fields", params, options);

export const fillFormFields = (params: FillParams, options?: RpcCallOptions) =>
  rpc<FillResult>("forms.fill", { language: currentLocale(), ...params }, options);

export const resetFormFields = (
  params: { path: string; password?: string; output: string; overwrite?: boolean; language?: string },
  options?: RpcCallOptions,
) => rpc<OutputResult>("forms.reset", { language: currentLocale(), ...params }, options);

export const comparePdfs = (params: CompareParams, options?: RpcCallOptions) =>
  rpc<CompareResult>("compare.run", params, options);

export const comparePageImages = (params: ComparePageImagesParams, options?: RpcCallOptions) =>
  rpc<ComparePageImagesResult>("compare.pageImages", params, options);

export const imposePages = (params: ImposeParams, options?: RpcCallOptions) =>
  rpc<ImposeResult>("pages.impose", params, options);

export const getBookmarks = (params: BookmarksGetParams, options?: RpcCallOptions) =>
  rpc<BookmarksGetResult>("bookmarks.get", params, options);

export const setBookmarks = (params: BookmarksSetParams, options?: RpcCallOptions) =>
  rpc<OutputResult>("bookmarks.set", params, options);

export const addBookmark = (params: BookmarkAddParams, options?: RpcCallOptions) =>
  rpc<BookmarkAddResult>("bookmarks.add", params, options);

export const generateBookmarks = (params: BookmarksGenerateParams, options?: RpcCallOptions) =>
  rpc<BookmarksGenerateResult>("bookmarks.generate", params, options);

export const exportBookmarks = (params: BookmarksExportParams, options?: RpcCallOptions) =>
  rpc<BookmarksExportResult>("bookmarks.export", params, options);

export const importBookmarks = (params: BookmarksImportParams, options?: RpcCallOptions) =>
  rpc<BookmarksGenerateResult>("bookmarks.import", params, options);

export const suggestBookmarks = (params: BookmarksSuggestParams, options?: RpcCallOptions) =>
  rpc<BookmarksGetResult>("bookmarks.suggest", params, options);

export const parseBookmarks = (params: BookmarksParseParams, options?: RpcCallOptions) =>
  rpc<BookmarksGetResult>("bookmarks.parse", params, options);

export const getTextSpans = (params: TextSpansParams, options?: RpcCallOptions) =>
  rpc<TextSpansResult>("textedit.spans", params, options);

export const getCodeBlocks = (params: CodeBlocksParams, options?: RpcCallOptions) =>
  rpc<CodeBlocksResult>("textedit.code_blocks", params, options);

export const replaceTextSpans = (params: TextReplaceParams, options?: RpcCallOptions) =>
  rpc<TextReplaceResult>("textedit.replace", params, options);

export const prepareView = (params: ViewPrepareParams, options?: RpcCallOptions) =>
  rpc<ViewPrepareResult>("viewer.prepare", params, options);

export const listLayers = (params: { path: string; password?: string }, options?: RpcCallOptions) =>
  rpc<LayersListResult>("layers.list", params, options);

export const restoreView = (params: ViewSourceParams, options?: RpcCallOptions) =>
  rpc<ViewRestoreResult>("viewer.restore", params, options);

export const redactedText = (params: RedactedTextParams, options?: RpcCallOptions) =>
  rpc<RedactedTextResult>("security.redacted_text", params, options);

export const scrubHidden = (params: ScrubHiddenParams, options?: RpcCallOptions) =>
  rpc<ScrubHiddenResult>("security.scrub_hidden", params, options);
