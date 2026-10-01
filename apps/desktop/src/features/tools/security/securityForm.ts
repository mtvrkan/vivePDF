import type { EncryptAlgorithm, OutputResult, PrivacyReport, RemoveWatermarkResult, SanitizeOption, SanitizeResult, StampResult, WatermarkKind } from "@/types";

export const SANITIZE_OPTIONS: SanitizeOption[] = ["metadata", "xmpMetadata", "imageMetadata", "thumbnails", "javascript", "embeddedFiles", "fileAttachments", "annotations", "links", "hiddenText", "offPage", "hiddenLayers", "bookmarks", "privateData", "resetForms"];

export const DEFAULT_SANITIZE: Record<SanitizeOption, boolean> = {
  metadata: true,
  xmpMetadata: true,
  imageMetadata: true,
  thumbnails: true,
  javascript: true,
  embeddedFiles: true,
  fileAttachments: true,
  annotations: false,
  links: false,
  hiddenText: false,
  offPage: false,
  hiddenLayers: false,
  bookmarks: false,
  privateData: true,
  resetForms: false,
};

const LEGACY_PASSWORD_EXTRAS = "•†‡…—–ƒ⁄‹›−‰„“”‘’‚™ﬁﬂŁŒŠŸŽıłœšž˘ˇˆ˙˝˛˚˜€";

export function legacyPasswordEncodable(value: string): boolean {
  return Array.from(value).every((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || LEGACY_PASSWORD_EXTRAS.includes(char);
  });
}

const AES256_PASSWORD_BYTES = 127;
const LEGACY_PASSWORD_BYTES = 32;

export function passwordByteLimit(algorithm: EncryptAlgorithm): number {
  return algorithm === "aes256" ? AES256_PASSWORD_BYTES : LEGACY_PASSWORD_BYTES;
}

export function passwordTooLong(value: string, algorithm: EncryptAlgorithm): boolean {
  const size = algorithm === "aes256" ? new TextEncoder().encode(value.normalize("NFKC")).length : Array.from(value).length;
  return size > passwordByteLimit(algorithm);
}

export function ownerRepeatsUser(userPassword: string, ownerPassword: string, restricted: boolean): boolean {
  return restricted && ownerPassword.length > 0 && ownerPassword === userPassword;
}

export function sealAlgorithm(algorithm: EncryptAlgorithm): EncryptAlgorithm {
  return algorithm === "rc4" ? "aes128" : algorithm;
}

export type SecurityTab = "encrypt" | "decrypt" | "certificate" | "decryptCertificate" | "watermark" | "stamp" | "removeWatermark" | "privacy";

export const SECURITY_TABS: SecurityTab[] = ["encrypt", "decrypt", "certificate", "decryptCertificate", "watermark", "removeWatermark", "stamp", "privacy"];

export function optionCount(report: PrivacyReport, option: SanitizeOption): number {
  switch (option) {
    case "metadata":
      return Object.keys(report.metadata).length;
    case "xmpMetadata":
      return report.xmpMetadata ? 1 : 0;
    case "imageMetadata":
      return report.imageMetadata ?? 0;
    case "javascript":
      return report.javascript;
    case "embeddedFiles":
      return report.embeddedFiles.length;
    case "fileAttachments":
      return report.fileAttachments;
    case "annotations":
      return report.annotations;
    case "links":
      return report.linkCount;
    case "hiddenText":
      return report.hiddenText;
    case "offPage":
      return report.offPageContent ?? 0;
    case "hiddenLayers":
      return report.hiddenLayers;
    case "bookmarks":
      return report.bookmarks;
    case "privateData":
      return report.privateData ?? 0;
    case "thumbnails":
      return report.thumbnails ?? 0;
    case "resetForms":
      return report.formFields;
  }
}

export function reportIsClean(report: PrivacyReport): boolean {
  return SANITIZE_OPTIONS.every((option) => option === "resetForms" || option === "bookmarks" || optionCount(report, option) === 0) && Object.keys(report.sensitive).length === 0;
}

export function removedTotal(result: OutputResult | RemoveWatermarkResult | SanitizeResult | StampResult): number | null {
  if ("removed" in result) return Object.values(result.removed).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!("removedText" in result)) return null;
  return result.removedText + result.removedAnnotations + result.removedImages + (result.removedMarks ?? 0) + (result.repaintedPages ?? 0);
}

export type SecurityFormState = {
  hasDocument: boolean;
  hasSource?: boolean;
  documentPassword: boolean;
  ownerOnly?: boolean;
  output: string;
  userPassword: string;
  ownerPassword: string;
  confirmPassword: string;
  algorithm?: EncryptAlgorithm;
  permissionsRestricted?: boolean;
  recipients: number;
  decryptPassword: string;
  sealedPath: string;
  holderPath: string;
  kind: WatermarkKind;
  text: string;
  imagePath: string;
  templatePath: string;
  stampText: string;
  removeText: string;
  chosenCandidates: number;
  scanned: boolean;
  removeAnnotations: boolean;
  removeImages: boolean;
  report: PrivacyReport | null;
  sanitizeOptions: Record<SanitizeOption, boolean>;
};

export function isReady(tab: SecurityTab, state: SecurityFormState): boolean {
  if (tab === "decryptCertificate") return !!state.sealedPath && !!state.holderPath && !!state.output;
  if (tab === "decrypt") return (state.hasDocument || !!state.hasSource) && !!state.output && (state.decryptPassword.length > 0 || state.documentPassword || !!state.ownerOnly);
  if (!state.hasDocument || !state.output) return false;
  switch (tab) {
    case "encrypt":
      return (
        (state.userPassword.length > 0 || state.ownerPassword.length > 0) &&
        state.confirmPassword === state.userPassword &&
        !passwordTooLong(state.userPassword, state.algorithm ?? "aes256") &&
        !passwordTooLong(state.ownerPassword, state.algorithm ?? "aes256") &&
        !ownerRepeatsUser(state.userPassword, state.ownerPassword, !!state.permissionsRestricted) &&
        (state.algorithm === undefined || state.algorithm === "aes256" || (legacyPasswordEncodable(state.userPassword) && legacyPasswordEncodable(state.ownerPassword)))
      );
    case "certificate":
      return state.recipients > 0;
    case "watermark":
      return state.kind === "text" ? state.text.trim().length > 0 : state.kind === "image" ? state.imagePath.length > 0 : state.templatePath.length > 0;
    case "stamp":
      return state.stampText.trim().length > 0;
    case "removeWatermark":
      return state.removeText.trim().length > 0 || state.chosenCandidates > 0 || (!state.scanned && (state.removeAnnotations || state.removeImages));
    case "privacy":
      return state.report !== null && SANITIZE_OPTIONS.some((option) => state.sanitizeOptions[option] && optionCount(state.report as PrivacyReport, option) > 0);
  }
}
