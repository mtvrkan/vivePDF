import { invoke } from "@tauri-apps/api/core";
import i18n, { currentLocale } from "@/app/i18n";
import { defaultOcrLanguages } from "@/app/locales";
import { outputFileName, patternIsValid, renderName } from "@/shared/lib/naming";
import { joinPath, numberedPath, outputDirectoryFor, pathKey, stemOf } from "@/shared/lib/paths";
import { sheetLabels } from "@/shared/lib/sheetLabels";
import type { StoredSecretUse } from "@/shared/rpc/client";
import { pruneChainSecrets } from "@/shared/rpc/chainSecrets";
import { deleteFile } from "@/shared/rpc/files";
import {
  compressPdf,
  convertPdfa,
  convertToDocx,
  convertToHtml,
  convertToImages,
  convertToMarkdown,
  convertToPptx,
  convertToText,
  convertToXlsx,
  deletePages,
  encryptPdf,
  extractPages,
  headerFooter,
  numberPages,
  removeWatermark,
  repairPdf,
  rotatePages,
  runOcr,
  setMetadata,
  signPdf,
  watermarkPdf,
} from "@/shared/rpc/operations";
import { PAGE_SCOPE_KINDS } from "@/shared/lib/pageScope";
import type { ChainSecretKind, ChainSecretStatus, CompressProfile, ImageFormat, PageScope, PageScopeKind, PdfaLevel, WatermarkPosition } from "@/types";

export type BatchOperation = "compress" | "ocr" | "repair" | "watermark" | "removeWatermark" | "headerFooter" | "number" | "rotate" | "delete" | "extract" | "metadata" | "pdfa" | "encrypt" | "sign" | "docx" | "xlsx" | "pptx" | "images" | "text" | "markdown" | "html";
export type StepSettings = {
  profile: CompressProfile;
  password: string;
  format: ImageFormat;
  watermarkText: string;
  languages: string;
  certificatePath: string;
  certificatePassword: string;
  reason: string;
  numberTemplate: string;
  numberPrefix: string;
  numberPadding: number;
  numberStart: number;
  numberContinue: boolean;
  pageScope: PageScopeKind;
  pageRanges: string;
  pageEvery: number;
  pageStart: number;
  rotateDegrees: number;
  markText: string;
  markFontSize: number;
  markColor: string;
  markOpacity: number;
  markRotation: number;
  markPosition: WatermarkPosition;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  furnitureFontSize: number;
  pdfaLevel: PdfaLevel;
  metaTitle: string;
  metaAuthor: string;
  metaSubject: string;
  metaKeywords: string;
};
export type ChainStep = { operation: BatchOperation; settings: StepSettings };
export type SavedChain = { id: string; name: string; steps: ChainStep[]; mergeAtEnd: boolean; nameTemplate?: string; storedSecrets?: ChainSecretKind[] };
export type ChainVault = { chainId: string; ticket: string; kinds: readonly ChainSecretKind[] };
export type ChainOutput = { output: string; bytes: number; password?: string };
export type ChainContext = { numbering: number; taken: Set<string>; sequence: number };
export type ChainNaming = { template?: string; n?: number };
export type ChainProblem = "empty" | "invalid" | "needsSecret";
export const CHAIN_FILE_FORMAT = "vivepdf.chains";
const CHAIN_FILE_VERSION = 1;

export const OPERATIONS: BatchOperation[] = ["compress", "ocr", "repair", "watermark", "removeWatermark", "headerFooter", "number", "rotate", "delete", "extract", "metadata", "pdfa", "encrypt", "sign", "docx", "xlsx", "pptx", "images", "text", "markdown", "html"];
export const PDF_OPERATIONS = new Set<BatchOperation>(["compress", "ocr", "repair", "watermark", "removeWatermark", "headerFooter", "number", "rotate", "delete", "extract", "metadata", "pdfa", "encrypt", "sign"]);
export const ROTATE_DEGREES = [90, 180, 270] as const;
export const PDFA_LEVELS: readonly PdfaLevel[] = ["1b", "2b", "2u", "3b"];
export const MARK_POSITIONS: readonly WatermarkPosition[] = ["center", "top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right", "tile"];
export const NAME_TEMPLATE_TOKENS = ["name", "suffix", "n", "date", "time", "year"] as const;
export const MARK_FONT = "bundled:dejavu-sans";
const FURNITURE_MARGIN_PT = 28;
export function createChainContext(): ChainContext {
  return { numbering: 0, taken: new Set(), sequence: 0 };
}
export const CHAINS_STORAGE_KEY = "vivepdf.batchChains";
const CERTIFICATE_KEY = "vivepdf.certificatePath";

const SUFFIX_KEY: Partial<Record<BatchOperation, string>> = {
  compress: "tools.compress.suffix",
  encrypt: "tools.security.encrypt.suffix",
  removeWatermark: "tools.security.removeWatermark.suffix",
  sign: "tools.sign.suffix",
  number: "tools.edit.number.suffix",
  repair: "tools.edit.repair.suffix",
  watermark: "tools.security.watermark.suffix",
  headerFooter: "tools.edit.headerFooter.suffix",
  metadata: "tools.batch.metadataSuffix",
  pdfa: "tools.pdfa.suffix",
  rotate: "tools.pageTools.rotateSuffix",
  delete: "tools.pageTools.deleteSuffix",
  extract: "tools.pageTools.extractSuffix",
};

function suffixFor(operation: BatchOperation): string {
  const key = SUFFIX_KEY[operation];
  if (!key) return operation;
  const translated = i18n.t(key);
  return translated && translated !== key ? translated : operation;
}
const EXTENSION: Partial<Record<BatchOperation, string>> = { docx: "docx", xlsx: "xlsx", pptx: "pptx", text: "txt", markdown: "md", html: "html" };

function rememberedCertificate(): string {
  try {
    return localStorage.getItem(CERTIFICATE_KEY) ?? "";
  } catch {
    return "";
  }
}

export const defaultStepSettings = (): StepSettings => ({
  profile: "balanced",
  password: "",
  format: "png",
  watermarkText: "",
  languages: defaultOcrLanguages(currentLocale()).join("+"),
  certificatePath: rememberedCertificate(),
  certificatePassword: "",
  reason: "",
  numberTemplate: "{n}",
  numberPrefix: "",
  numberPadding: 0,
  numberStart: 1,
  numberContinue: true,
  pageScope: "all",
  pageRanges: "",
  pageEvery: 2,
  pageStart: 1,
  rotateDegrees: 90,
  markText: "",
  markFontSize: 48,
  markColor: "#c00000",
  markOpacity: 30,
  markRotation: 45,
  markPosition: "center",
  headerLeft: "",
  headerCenter: "",
  headerRight: "",
  footerLeft: "",
  footerCenter: "",
  footerRight: "",
  furnitureFontSize: 11,
  pdfaLevel: "2b",
  metaTitle: "",
  metaAuthor: "",
  metaSubject: "",
  metaKeywords: "",
});

const FURNITURE_SLOTS = ["headerLeft", "headerCenter", "headerRight", "footerLeft", "footerCenter", "footerRight"] as const;
const METADATA_FIELDS = ["metaTitle", "metaAuthor", "metaSubject", "metaKeywords"] as const;

function hasText(settings: StepSettings, keys: readonly (keyof StepSettings)[]): boolean {
  return keys.some((key) => String(settings[key]).trim().length > 0);
}

export function nameTemplateIsValid(template: string): boolean {
  const trimmed = template.trim();
  return trimmed.length === 0 || patternIsValid(trimmed) || trimmed.includes("{n}");
}

function metadataValue(value: string, sourceStem: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/\{name\}/g, sourceStem) : undefined;
}

export function stepScope(settings: StepSettings): PageScope {
  if (settings.pageScope === "ranges") return { kind: "ranges", ranges: settings.pageRanges };
  if (settings.pageScope === "every") return { kind: "every", every: Math.max(1, Math.floor(settings.pageEvery)), start: Math.max(1, Math.floor(settings.pageStart)) };
  return { kind: settings.pageScope };
}

function rotationOf(settings: StepSettings): 90 | 180 | 270 {
  return ROTATE_DEGREES.find((value) => value === settings.rotateDegrees) ?? 90;
}

function stripStepSecrets(step: ChainStep): ChainStep {
  return { ...step, settings: { ...step.settings, password: "", certificatePassword: "" } };
}

function stripChainSecrets(chain: SavedChain): SavedChain {
  return { ...chain, steps: chain.steps.map(stripStepSecrets) };
}

function withoutStoredSecrets(chain: SavedChain): SavedChain {
  const copy = { ...chain };
  delete copy.storedSecrets;
  return copy;
}

function exportableChain(chain: SavedChain): SavedChain {
  return withoutStoredSecrets(stripChainSecrets(chain));
}

const SECRET_KINDS: readonly ChainSecretKind[] = ["encrypt", "sign"];

export function secretKindsOf(steps: ChainStep[]): ChainSecretKind[] {
  return SECRET_KINDS.filter((kind) => steps.some((step) => step.operation === kind));
}

export type SecretToRemember = { kind: ChainSecretKind; secret: string; certificatePath?: string };

export function secretsToRemember(steps: ChainStep[]): SecretToRemember[] {
  const found: SecretToRemember[] = [];
  const encrypt = steps.find((step) => step.operation === "encrypt" && step.settings.password.length > 0);
  if (encrypt) found.push({ kind: "encrypt", secret: encrypt.settings.password });
  const sign = steps.find((step) => step.operation === "sign" && step.settings.certificatePassword.length > 0 && step.settings.certificatePath.length > 0);
  if (sign) found.push({ kind: "sign", secret: sign.settings.certificatePassword, certificatePath: sign.settings.certificatePath });
  return found;
}

export function storedSecretsOf(chain: SavedChain | undefined): ChainSecretKind[] {
  if (!chain?.storedSecrets) return [];
  const needed = secretKindsOf(chain.steps);
  return needed.filter((kind) => chain.storedSecrets?.includes(kind));
}

function cleanStoredSecrets(chain: SavedChain): SavedChain {
  const rest = withoutStoredSecrets(chain);
  const stored = storedSecretsOf(chain);
  return stored.length > 0 ? { ...rest, storedSecrets: stored } : rest;
}

export function withSecretStatus(chains: SavedChain[], statuses: ChainSecretStatus[]): SavedChain[] {
  const byId = new Map(statuses.map((status) => [status.chainId, status]));
  return chains.map((chain) => {
    const status = byId.get(chain.id);
    const stored = SECRET_KINDS.filter((kind) => status?.[kind]);
    return cleanStoredSecrets({ ...chain, storedSecrets: stored });
  });
}

function hasStoredSecret(chain: SavedChain): boolean {
  return chain.steps.some((step) => step.settings.password.length > 0 || step.settings.certificatePassword.length > 0);
}

export function readSavedChains(): SavedChain[] {
  try {
    const raw = localStorage.getItem(CHAINS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const chains = (Array.isArray(parsed) ? (parsed as SavedChain[]) : []).map(cleanStoredSecrets);
    if (chains.some(hasStoredSecret)) {
      const sanitized = chains.map(stripChainSecrets);
      persistSavedChains(sanitized);
      return sanitized;
    }
    return chains;
  } catch {
    return [];
  }
}

export async function reconcileStoredSecrets(): Promise<void> {
  try {
    localStorage.getItem(CHAINS_STORAGE_KEY);
  } catch {
    return;
  }
  const statuses = await pruneChainSecrets(readSavedChains().map((chain) => chain.id));
  persistSavedChains(withSecretStatus(readSavedChains(), statuses));
}

export function persistSavedChains(chains: SavedChain[]) {
  try {
    localStorage.setItem(CHAINS_STORAGE_KEY, JSON.stringify(chains.map(stripChainSecrets)));
  } catch {
    return;
  }
}

export function chainIsValid(steps: ChainStep[]): boolean {
  return steps.length > 0 && steps.every((step, index) => index === steps.length - 1 || PDF_OPERATIONS.has(step.operation));
}

export function chainProducesPdf(steps: ChainStep[]): boolean {
  return steps.length === 0 || PDF_OPERATIONS.has(steps[steps.length - 1].operation);
}

export function stepIsReady(step: ChainStep, stored: readonly ChainSecretKind[] = []): boolean {
  if (step.operation === "encrypt") return step.settings.password.length > 0 || stored.includes("encrypt");
  if (step.operation === "sign") return step.settings.certificatePath.length > 0;
  if ((step.operation === "rotate" || step.operation === "delete" || step.operation === "extract") && step.settings.pageScope === "ranges") return step.settings.pageRanges.trim().length > 0;
  if (step.operation === "watermark") return step.settings.markText.trim().length > 0;
  if (step.operation === "headerFooter") return hasText(step.settings, FURNITURE_SLOTS);
  if (step.operation === "metadata") return hasText(step.settings, METADATA_FIELDS);
  return true;
}

export function chainProblem(steps: ChainStep[] | undefined, stored: readonly ChainSecretKind[] = []): ChainProblem | null {
  if (!steps || steps.length === 0) return "empty";
  if (!chainIsValid(steps)) return "invalid";
  if (!steps.every((step) => stepIsReady(step, stored))) return "needsSecret";
  return null;
}

const MAX_NAME_ATTEMPTS = 50;
const MAX_NAME_PAGES = 20;

export function claimOutputPath(path: string, taken: Set<string>): string {
  let candidate = path;
  for (let index = 2; taken.has(pathKey(candidate)); index += 1) candidate = numberedPath(path, index);
  taken.add(pathKey(candidate));
  return candidate;
}

async function existingPaths(paths: string[]): Promise<boolean[]> {
  try {
    const result = await invoke<boolean[]>("path_exists", { paths });
    return Array.isArray(result) && result.length === paths.length ? result : paths.map(() => false);
  } catch {
    return paths.map(() => false);
  }
}

export async function claimFreeOutputPath(path: string, taken: Set<string>): Promise<string> {
  for (let page = 0; page < MAX_NAME_PAGES; page += 1) {
    const candidates = Array.from({ length: MAX_NAME_ATTEMPTS }, (_, index) => numberedPath(path, page * MAX_NAME_ATTEMPTS + index + 1));
    const exists = await existingPaths(candidates);
    const free = candidates.find((candidate, index) => !exists[index] && !taken.has(pathKey(candidate)));
    if (free) return claimOutputPath(free, taken);
  }
  return claimOutputPath(numberedPath(path, Date.now()), taken);
}

export function chainOutputPath(file: string, operation: BatchOperation, directory: string, format: ImageFormat, intermediate: boolean, stepIndex = 0, naming: ChainNaming = {}): string {
  const targetDir = directory || outputDirectoryFor(file);
  const stem = stemOf(file);
  const template = naming.template?.trim() ?? "";
  const finalName = (suffix: string) => (template && nameTemplateIsValid(template) ? renderName(template, { name: stem, suffix, n: naming.n ?? 1 }) : outputFileName(stem, suffix));
  if (operation === "images") return joinPath(targetDir, finalName(format));
  const extension = EXTENSION[operation];
  if (extension) return joinPath(targetDir, `${finalName("")}.${extension}`);
  const suffix = suffixFor(operation);
  return joinPath(targetDir, intermediate ? `${stem}.${stepIndex + 1}-${suffix}.tmp-vivepdf.pdf` : `${finalName(suffix)}.pdf`);
}

type NumberingRun = { start: number; pages: number };

function storedSecretUse(step: ChainStep, vault: ChainVault | undefined, lockedByVault: boolean): StoredSecretUse | undefined {
  if (!vault) return undefined;
  const kinds: ChainSecretKind[] = [];
  const encryptsFromVault = step.operation === "encrypt" && !step.settings.password && vault.kinds.includes("encrypt");
  if (lockedByVault || encryptsFromVault) kinds.push("encrypt");
  if (step.operation === "sign" && !step.settings.certificatePassword && vault.kinds.includes("sign")) kinds.push("sign");
  return kinds.length > 0 ? { chainId: vault.chainId, ticket: vault.ticket, kinds } : undefined;
}

async function runStep(step: ChainStep, input: string, output: string, signal: AbortSignal, numbering: NumberingRun, password: string | undefined, overwrite: boolean, sourceStem: string, secret?: StoredSecretUse): Promise<ChainOutput> {
  const options = { signal, secret };
  const base = { path: input, output, overwrite, password };
  const { settings } = step;
  switch (step.operation) {
    case "repair": {
      const result = await repairPdf(base, options);
      return { output: result.output, bytes: result.bytes };
    }
    case "watermark": {
      const result = await watermarkPdf(
        {
          ...base,
          kind: "text",
          text: settings.markText,
          fontSize: settings.markFontSize,
          bold: true,
          color: settings.markColor,
          fontId: MARK_FONT,
          opacity: Math.min(100, Math.max(5, settings.markOpacity)) / 100,
          rotation: settings.markRotation,
          position: settings.markPosition,
          scale: 0.5,
        },
        options,
      );
      return { output: result.output, bytes: result.bytes };
    }
    case "headerFooter": {
      const result = await headerFooter(
        {
          ...base,
          headerLeft: settings.headerLeft,
          headerCenter: settings.headerCenter,
          headerRight: settings.headerRight,
          footerLeft: settings.footerLeft,
          footerCenter: settings.footerCenter,
          footerRight: settings.footerRight,
          fontSize: settings.furnitureFontSize,
          margin: FURNITURE_MARGIN_PT,
          color: "#000000",
          fontId: MARK_FONT,
        },
        options,
      );
      return { output: result.output, bytes: result.bytes };
    }
    case "metadata": {
      const result = await setMetadata(
        {
          ...base,
          inPlace: false,
          title: metadataValue(settings.metaTitle, sourceStem),
          author: metadataValue(settings.metaAuthor, sourceStem),
          subject: metadataValue(settings.metaSubject, sourceStem),
          keywords: metadataValue(settings.metaKeywords, sourceStem),
        },
        options,
      );
      return { output: result.output, bytes: result.bytes };
    }
    case "pdfa": {
      const result = await convertPdfa({ ...base, level: settings.pdfaLevel }, options);
      return { output: result.output, bytes: result.bytes };
    }
    case "compress": {
      const result = await compressPdf({ ...base, profile: settings.profile }, options);
      return { output: result.output, bytes: result.bytesAfter };
    }
    case "ocr":
      return await runOcr({ ...base, languages: settings.languages.split(/[+,\s]+/).filter(Boolean), dpi: 200, mode: "skip_text" }, options);
    case "removeWatermark":
      return await removeWatermark({ ...base, text: settings.watermarkText.trim() || undefined, annotations: true, repeatedImages: true, tagged: true, artifacts: true }, options);
    case "encrypt":
      return await encryptPdf(
        {
          ...base,
          userPassword: settings.password,
          ownerPassword: settings.password,
          algorithm: "aes256",
          permissions: { print: true, printHighQuality: true, copyText: true, modify: true, annotate: true, fillForms: true, accessibility: true, assemble: true },
        },
        options,
      );
    case "sign": {
      const result = await signPdf(
        {
          ...base,
          certificatePath: settings.certificatePath,
          certificatePassword: settings.certificatePassword,
          page: 1,
          visible: false,
          reason: settings.reason,
          location: "",
          contact: "",
        },
        options,
      );
      return { output: result.output, bytes: result.bytes };
    }
    case "number": {
      const start = settings.numberStart + (settings.numberContinue ? numbering.start : 0);
      const result = await numberPages({ ...base, template: settings.numberTemplate || "{n}", start, prefix: settings.numberPrefix, padding: settings.numberPadding, position: "bottom-center", fontSize: 11, margin: 28, color: "#000000", bold: false }, options);
      numbering.pages = Math.max(numbering.pages, result.pageCount);
      return { output: result.output, bytes: result.bytes };
    }
    case "rotate": {
      const result = await rotatePages({ ...base, scope: stepScope(settings), degrees: rotationOf(settings) }, options);
      return { output: result.output, bytes: result.bytes };
    }
    case "delete": {
      const result = await deletePages({ ...base, scope: stepScope(settings) }, options);
      return { output: result.output, bytes: result.bytes };
    }
    case "extract": {
      const result = await extractPages({ ...base, scope: stepScope(settings) }, options);
      return { output: result.output, bytes: result.bytes };
    }
    case "docx":
      return await convertToDocx(base, options);
    case "xlsx":
      return await convertToXlsx({ ...base, ...sheetLabels((key) => i18n.t(key)) }, options);
    case "pptx":
      return await convertToPptx({ ...base, dpi: 150 }, options);
    case "text":
      return await convertToText({ ...base, layout: false }, options);
    case "markdown":
      return await convertToMarkdown(base, options);
    case "html":
      return await convertToHtml(base, options);
    case "images": {
      const result = await convertToImages({ path: input, password, outputDir: output, format: settings.format, dpi: 150, overwrite }, options);
      return { output, bytes: result.bytes };
    }
  }
}

export async function runChain(
  steps: ChainStep[],
  path: string,
  directory: string,
  signal: AbortSignal,
  onStep?: (index: number) => void,
  password?: string,
  context: ChainContext = createChainContext(),
  naming: ChainNaming = {},
  vault?: ChainVault,
): Promise<ChainOutput> {
  let input = path;
  let carried = password;
  let lockedByVault = false;
  let last: ChainOutput = { output: path, bytes: 0 };
  const working = new Set<string>();
  const numbering: NumberingRun = { start: context.numbering, pages: 0 };
  const fileNaming: ChainNaming = { template: naming.template, n: naming.n ?? context.sequence + 1 };
  const sourceStem = stemOf(path);
  try {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const isLast = index === steps.length - 1;
      const planned = chainOutputPath(path, step.operation, directory, step.settings.format, !isLast, index, fileNaming);
      const output = isLast ? await claimFreeOutputPath(planned, context.taken) : planned;
      if (!isLast) working.add(output);
      onStep?.(index);
      const secret = storedSecretUse(step, vault, lockedByVault);
      last = await runStep(step, input, output, signal, numbering, lockedByVault ? undefined : carried, !isLast, sourceStem, secret);
      if (step.operation === "encrypt") {
        lockedByVault = secret?.kinds.includes("encrypt") ?? false;
        carried = lockedByVault ? undefined : step.settings.password;
      }
      if (working.delete(input)) await deleteFile(input).catch(() => undefined);
      input = last.output;
    }
    context.numbering = numbering.start + numbering.pages;
    context.sequence += 1;
    return { ...last, password: carried };
  } finally {
    for (const file of working) await deleteFile(file).catch(() => undefined);
  }
}

type ChainFile = { format: string; version: number; chains: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSettings(raw: unknown): StepSettings {
  const defaults = defaultStepSettings();
  if (!isRecord(raw)) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = raw[key];
    if (typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value))) merged[key] = value;
  }
  const settings = merged as StepSettings;
  return {
    ...settings,
    pageScope: PAGE_SCOPE_KINDS.includes(settings.pageScope) ? settings.pageScope : defaults.pageScope,
    rotateDegrees: rotationOf(settings),
    markPosition: MARK_POSITIONS.includes(settings.markPosition) ? settings.markPosition : defaults.markPosition,
    pdfaLevel: PDFA_LEVELS.includes(settings.pdfaLevel) ? settings.pdfaLevel : defaults.pdfaLevel,
    markColor: /^#[0-9a-f]{6}$/i.test(settings.markColor) ? settings.markColor : defaults.markColor,
    password: "",
    certificatePassword: "",
  };
}

export function serializeChains(chains: SavedChain[]): string {
  const file: ChainFile = { format: CHAIN_FILE_FORMAT, version: CHAIN_FILE_VERSION, chains: chains.map(exportableChain) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseChainFile(text: string): SavedChain[] {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  const list = isRecord(parsed) && parsed.format === CHAIN_FILE_FORMAT ? parsed.chains : Array.isArray(parsed) ? parsed : null;
  if (!Array.isArray(list)) throw new Error("not a chain file");
  const chains: SavedChain[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim() || !Array.isArray(item.steps)) continue;
    const steps: ChainStep[] = [];
    for (const step of item.steps) {
      if (!isRecord(step) || !OPERATIONS.includes(step.operation as BatchOperation)) continue;
      steps.push({ operation: step.operation as BatchOperation, settings: sanitizeSettings(step.settings) });
    }
    if (steps.length === 0) continue;
    const nameTemplate = typeof item.nameTemplate === "string" && item.nameTemplate.trim() && nameTemplateIsValid(item.nameTemplate) ? item.nameTemplate.trim() : undefined;
    chains.push({ id: crypto.randomUUID(), name: item.name.trim(), steps, mergeAtEnd: item.mergeAtEnd === true, ...(nameTemplate ? { nameTemplate } : {}) });
  }
  if (chains.length === 0) throw new Error("no chains in file");
  return chains;
}

export function mergeChains(existing: SavedChain[], incoming: SavedChain[]): { chains: SavedChain[]; replacedIds: string[] } {
  const result = [...existing];
  const replacedIds: string[] = [];
  for (const chain of incoming) {
    const sameName = result.findIndex((item) => item.name === chain.name);
    if (sameName >= 0) {
      replacedIds.push(result[sameName].id);
      result[sameName] = { ...chain, id: result[sameName].id };
      continue;
    }
    const idTaken = result.some((item) => item.id === chain.id);
    result.push(idTaken ? { ...chain, id: crypto.randomUUID() } : chain);
  }
  return { chains: result, replacedIds };
}

export function upsertChain(chains: SavedChain[], name: string, steps: ChainStep[], mergeAtEnd: boolean, nameTemplate = ""): SavedChain[] {
  const existing = chains.find((chain) => chain.name === name);
  const template = nameTemplate.trim();
  const stored = existing ? storedSecretsOf({ ...existing, steps }) : [];
  const saved: SavedChain = { id: existing?.id ?? crypto.randomUUID(), name, steps, mergeAtEnd, ...(template ? { nameTemplate: template } : {}), ...(stored.length > 0 ? { storedSecrets: stored } : {}) };
  return existing ? chains.map((chain) => (chain.id === existing.id ? saved : chain)) : [...chains, saved];
}
