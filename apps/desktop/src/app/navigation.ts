import {
  Accessibility,
  Archive,
  ArrowLeftRight,
  BadgeCheck,
  Bookmark,
  BookOpen,
  Camera,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Layers,
  Combine,
  Crop,
  Droplet,
  EyeOff,
  FileInput,
  FileImage,
  FileKey,
  FileOutput,
  FileText,
  FolderSync,
  GitCompareArrows,
  Globe,
  Grid3x3,
  Hash,
  Highlighter,
  House,
  Image,
  Images,
  Info,
  KeyRound,
  Layers2,
  Link2,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockKeyholeOpen,
  LockOpen,
  Minimize2,
  PanelTop,
  PenLine,
  PenTool,
  Printer,
  Presentation,
  QrCode,
  Replace,
  RotateCw,
  Scaling,
  Scan,
  ScanLine,
  ScanText,
  Scissors,
  Search,
  Settings,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Eraser,
  FilePlus2,
  Stamp,
  Table2,
  Tags,
  TextCursorInput,
  Trash2,
  Type,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NavItem, Tone } from "@/types";

export const primaryNavigation: NavItem[] = [
  { id: "home", labelKey: "nav.home", route: "/", icon: House },
  { id: "viewer", labelKey: "nav.viewer", route: "/viewer", icon: BookOpen },
  { id: "pages", labelKey: "nav.pages", route: "/pages", icon: LayoutGrid },
  { id: "search", labelKey: "nav.search", route: "/search", icon: Search },
];

export const headerNavigation: NavItem[] = primaryNavigation.filter((item) => item.id !== "search");

export const toolNavigation: NavItem[] = [
  { id: "merge", labelKey: "nav.merge", route: "/tools/merge", tone: "organize", icon: Combine },
  { id: "split", labelKey: "nav.split", route: "/tools/split", tone: "organize", icon: Scissors },
  { id: "compress", labelKey: "nav.compress", route: "/tools/compress", tone: "improve", icon: Minimize2 },
  { id: "convert", labelKey: "nav.convert", route: "/tools/convert", tone: "fromPdf", icon: ArrowLeftRight },
  { id: "create", labelKey: "nav.create", route: "/tools/create", tone: "toPdf", icon: FilePlus2 },
  { id: "ocr", labelKey: "nav.ocr", route: "/tools/ocr", tone: "improve", icon: ScanText },
  { id: "scan", labelKey: "nav.scan", route: "/tools/scan", tone: "improve", icon: ScanLine },
  { id: "edit", labelKey: "nav.edit", route: "/tools/edit", tone: "edit", icon: PenLine },
  { id: "codes", labelKey: "nav.codes", route: "/tools/codes", tone: "edit", icon: QrCode },
  { id: "omr", labelKey: "nav.omr", route: "/tools/omr", tone: "edit", icon: ClipboardCheck },
  { id: "security", labelKey: "nav.security", route: "/tools/security", tone: "security", icon: ShieldCheck },
  { id: "sign", labelKey: "nav.sign", route: "/tools/sign", tone: "security", icon: PenTool },
  { id: "forms", labelKey: "nav.forms", route: "/tools/forms", tone: "edit", icon: ClipboardList },
  { id: "compare", labelKey: "nav.compare", route: "/tools/compare", tone: "improve", icon: GitCompareArrows },
  { id: "access", labelKey: "nav.access", route: "/tools/access", tone: "improve", icon: Accessibility },
  { id: "preflight", labelKey: "nav.preflight", route: "/tools/preflight", tone: "improve", icon: Printer },
  { id: "pdfa", labelKey: "nav.pdfa", route: "/tools/pdfa", tone: "improve", icon: Archive },
  { id: "rename", labelKey: "nav.rename", route: "/tools/rename", tone: "organize", icon: Tags },
  { id: "batch", labelKey: "nav.batch", route: "/tools/batch", tone: "improve", icon: Layers },
  { id: "watch", labelKey: "nav.watch", route: "/tools/watch", tone: "improve", icon: FolderSync },
];

export const settingsNavigation: NavItem = {
  id: "settings",
  labelKey: "nav.settings",
  route: "/settings",
  icon: Settings,
};

export const aboutNavigation: NavItem = {
  id: "about",
  labelKey: "nav.about",
  route: "/about",
  icon: Info,
};

export const secondaryNavigation: NavItem[] = [settingsNavigation, aboutNavigation];

const allNavigation = [...primaryNavigation, ...toolNavigation, ...secondaryNavigation];

export function findNavItem(id: string): NavItem | undefined {
  return allNavigation.find((item) => item.id === id);
}

export function findNavItemByRoute(pathname: string): NavItem | undefined {
  return allNavigation.find((item) => (item.route === "/" ? pathname === "/" : pathname.startsWith(item.route)));
}

export type ToolGroup = Tone;

export type ToolShortcut = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  route: string;
  group: ToolGroup;
  icon: LucideIcon;
  keywords: string;
};

function shortcut(id: string, labelKey: string, route: string, group: ToolGroup, icon: LucideIcon, keywords = ""): ToolShortcut {
  return { id, labelKey, descriptionKey: `tools.grid.descriptions.${id}`, route, group, icon, keywords };
}

export const toolShortcuts: ToolShortcut[] = [
  shortcut("merge", "nav.merge", "/tools/merge", "organize", Combine, "combine join"),
  shortcut("split", "nav.split", "/tools/split", "organize", Scissors, "divide"),
  shortcut("pages", "tools.grid.organizer", "/pages", "organize", LayoutGrid, "reorder sort drag"),
  shortcut("rotate", "tools.grid.rotate", "/tools/pages?tab=rotate", "organize", RotateCw, "turn"),
  shortcut("delete", "tools.grid.deletePages", "/tools/pages?tab=delete", "organize", Trash2, "remove"),
  shortcut("extract", "tools.grid.extractPages", "/tools/pages?tab=extract", "organize", FileOutput, "export"),
  shortcut("compress", "nav.compress", "/tools/compress", "improve", Minimize2, "shrink reduce size"),
  shortcut("repair", "tools.edit.repair.title", "/tools/edit?tab=repair", "improve", Wrench, "fix corrupt"),
  shortcut("ocr", "nav.ocr", "/tools/ocr", "improve", ScanText, "scan text recognize"),
  shortcut("compare", "nav.compare", "/tools/compare", "improve", GitCompareArrows, "diff"),
  shortcut("access", "nav.access", "/tools/access", "improve", Accessibility, "accessibility pdf/ua alt text tags language title erisilebilirlik"),
  shortcut("preflight", "nav.preflight", "/tools/preflight", "improve", Printer, "preflight print check fonts dpi bleed baski kontrol matbaa"),
  shortcut("pdfa", "nav.pdfa", "/tools/pdfa", "improve", Archive, "pdf/a pdfa archive archival long term validate conformance arsiv uzun sureli dogrula"),
  shortcut("batch", "nav.batch", "/tools/batch", "improve", Layers, "batch bulk multiple toplu"),
  shortcut("watch", "nav.watch", "/tools/watch", "improve", FolderSync, "watched folder automation izle klasor"),
  shortcut("scanner", "tools.scan.scanner.title", "/tools/scan?tab=scanner", "improve", Scan, "scanner wia acquire twain flatbed feeder tarayici tara"),
  shortcut("scan-enhance", "tools.scan.enhance.title", "/tools/scan?tab=enhance", "improve", ScanLine, "scan deskew despeckle whiten clean tarama duzelt"),
  shortcut("scan-split", "tools.scan.split.title", "/tools/scan?tab=split", "organize", ScanLine, "scan split separator qr blank batch tarama bol"),
  shortcut("photo", "tools.scan.photo.title", "/tools/scan?tab=photo", "toPdf", Camera, "photo phone camera document scan perspective fotograf telefon belge"),
  shortcut("rename", "nav.rename", "/tools/rename", "organize", Tags, "rename invoice date title bulk yeniden adlandir fatura tarih"),
  shortcut("qr-add", "tools.codes.add.title", "/tools/codes?tab=add", "edit", QrCode, "qr code stamp link karekod ekle"),
  shortcut("barcode-read", "tools.codes.read.title", "/tools/codes?tab=read", "edit", QrCode, "barcode qr read scan list barkod oku"),
  shortcut("omr-sheet", "tools.omr.sheet.title", "/tools/omr?tab=sheet", "edit", ClipboardCheck, "omr optical answer sheet bubble exam test optik form cevap kagidi sinav"),
  shortcut("omr-grade", "tools.omr.grade.title", "/tools/omr?tab=grade", "edit", ClipboardCheck, "omr optical grade score read answer key exam optik okut puanla cevap anahtari sinav"),
  shortcut("create-document", "nav.create", "/tools/create", "toPdf", FilePlus2, "create new document text txt markdown template report letter petition minutes notes booklet olustur yeni belge metin sablon rapor mektup dilekce tutanak ders notu kitapcik odev"),
  shortcut("images-to-pdf", "tools.convert.modes.images-to-pdf", "/tools/convert?mode=images-to-pdf", "toPdf", Images, "jpg png folder"),
  shortcut("file-to-pdf", "tools.convert.modes.file-to-pdf", "/tools/convert?mode=file-to-pdf", "toPdf", FileInput, "word excel powerpoint office html markdown"),
  shortcut("svg-to-pdf", "tools.convert.modes.svg-to-pdf", "/tools/convert?mode=svg-to-pdf", "toPdf", Shapes, "svg vector drawing inkscape illustrator figma logo icon vektor cizim"),
  shortcut("url-to-pdf", "tools.convert.modes.url-to-pdf", "/tools/convert?mode=url-to-pdf", "toPdf", Globe, "url web page website link site sayfa adres kaydet"),
  shortcut("docx", "tools.convert.modes.docx", "/tools/convert?mode=docx", "fromPdf", FileText, "word"),
  shortcut("xlsx", "tools.convert.modes.xlsx", "/tools/convert?mode=xlsx", "fromPdf", Table2, "excel table"),
  shortcut("pptx", "tools.convert.modes.pptx", "/tools/convert?mode=pptx", "fromPdf", Presentation, "powerpoint"),
  shortcut("images", "tools.convert.modes.images", "/tools/convert?mode=images", "fromPdf", Image, "jpg png webp"),
  shortcut("text", "tools.convert.modes.text", "/tools/convert?mode=text", "fromPdf", Type, "txt"),
  shortcut("markdown", "tools.convert.modes.markdown", "/tools/convert?mode=markdown", "fromPdf", Hash, "md"),
  shortcut("html", "tools.convert.modes.html", "/tools/convert?mode=html", "fromPdf", Code2, "web"),
  shortcut("epub", "tools.convert.modes.epub", "/tools/convert?mode=epub", "fromPdf", BookOpen, "ebook epub kindle kobo reflow e-kitap oku"),
  shortcut("number", "tools.edit.number.title", "/tools/edit?tab=number", "edit", ListOrdered, "page numbers"),
  shortcut("headerFooter", "tools.edit.headerFooter.title", "/tools/edit?tab=headerFooter", "edit", PanelTop, "header footer"),
  shortcut("letterhead", "tools.edit.letterhead.title", "/tools/edit?tab=letterhead", "edit", FileImage, "letterhead template stationery antetli kagit sablon"),
  shortcut("findReplace", "tools.edit.findReplace.title", "/tools/edit?tab=findReplace", "edit", Replace, "find replace text search bul degistir"),
  shortcut("watermark", "tools.security.watermark.title", "/tools/security?tab=watermark", "edit", Droplet, "stamp logo watermark filigran"),
  shortcut("removeWatermark", "tools.security.removeWatermark.title", "/tools/security?tab=removeWatermark", "edit", Eraser, "clean stamp logo unwatermark"),
  shortcut("stamp", "tools.security.stamp.title", "/tools/security?tab=stamp", "edit", Stamp, "stamp approved draft confidential damga onaylandi taslak gizli"),
  shortcut("crop", "tools.edit.crop.title", "/tools/edit?tab=crop", "edit", Crop, "margins"),
  shortcut("resize", "tools.edit.resize.title", "/tools/edit?tab=resize", "edit", Scaling, "a4 letter scale"),
  shortcut("flatten", "tools.edit.flatten.title", "/tools/edit?tab=flatten", "edit", Layers2, "bake"),
  shortcut("impose", "tools.edit.impose.title", "/tools/edit?tab=impose", "edit", LayoutGrid, "booklet n-up nup imposition"),
  shortcut("poster", "tools.edit.poster.title", "/tools/edit?tab=poster", "edit", Grid3x3, "poster tile tiling banner enlarge large print doseme buyut afis"),
  shortcut("bookmarks", "tools.edit.bookmarks.title", "/tools/edit?tab=bookmarks", "edit", Bookmark, "toc outline table of contents"),
  shortcut("autolink", "tools.edit.autolink.title", "/tools/edit?tab=autolink", "edit", Link2, "auto link url email hyperlink clickable baglanti otomatik tiklanabilir eposta"),
  shortcut("textedit", "tools.edit.textedit.title", "/tools/edit?tab=textedit", "edit", TextCursorInput, "edit text content experimental"),
  shortcut("forms", "tools.forms.tabs.fill", "/tools/forms?tab=fill", "edit", ClipboardList, "fill acroform forms form doldur"),
  shortcut("form-merge", "tools.forms.tabs.merge", "/tools/forms?tab=merge", "edit", ClipboardList, "mail merge csv excel batch fill toplu doldur"),
  shortcut("form-export", "tools.forms.tabs.export", "/tools/forms?tab=export", "edit", ClipboardList, "export forms excel csv table toplu form"),
  shortcut("form-detect", "tools.forms.tabs.detect", "/tools/forms?tab=detect", "edit", ClipboardList, "detect fields lines boxes alan algila"),
  shortcut("annotate", "viewer.annotate", "/viewer", "edit", Highlighter, "highlight draw note"),
  shortcut("encrypt", "tools.security.encrypt.title", "/tools/security?tab=encrypt", "security", Lock, "password protect"),
  shortcut("decrypt", "tools.security.decrypt.title", "/tools/security?tab=decrypt", "security", LockOpen, "remove password unlock"),
  shortcut("seal", "tools.security.certificate.title", "/tools/security?tab=certificate", "security", FileKey, "certificate recipient public key pubsec seal sertifika muhurle alici"),
  shortcut("unseal", "tools.security.decryptCertificate.title", "/tools/security?tab=decryptCertificate", "security", LockKeyholeOpen, "certificate private key p12 pfx open sealed sertifika ac muhur"),
  shortcut("redact", "tools.edit.redact.title", "/tools/edit?tab=redact", "security", EyeOff, "black out remove"),
  shortcut("privacy", "tools.security.privacy.title", "/tools/security?tab=privacy", "security", ShieldAlert, "privacy sanitize metadata javascript share check gizlilik temizle"),
  shortcut("sign", "tools.sign.sign.title", "/tools/sign?tab=sign", "security", PenTool, "signature pades"),
  shortcut("verify", "tools.sign.verify.title", "/tools/sign?tab=verify", "security", BadgeCheck, "validate signature"),
  shortcut("certificate", "tools.sign.certificate.title", "/tools/sign?tab=certificate", "security", KeyRound, "p12 pfx"),
  shortcut("certificate-export", "tools.sign.export.title", "/tools/sign?tab=export", "security", FileOutput, "cer der public certificate export p12 pfx sertifika disa aktar acik anahtar"),
];

export const toolGroups: ToolGroup[] = ["organize", "improve", "toPdf", "fromPdf", "edit", "security"];

export const homeQuickActionIds = ["merge", "split", "compress", "images-to-pdf", "docx", "pages"] as const;

export const toolGroupIcons: Record<ToolGroup, LucideIcon> = {
  organize: LayoutGrid,
  improve: Sparkles,
  toPdf: FileInput,
  fromPdf: FileOutput,
  edit: PenLine,
  security: ShieldCheck,
};


export function menuItemsForGroup(group: ToolGroup): NavItem[] {
  const items = toolNavigation.filter((item) => item.tone === group);
  if (items.length > 0) return items;
  return toolShortcuts
    .filter((tool) => tool.group === group)
    .map((tool) => ({ id: tool.id, labelKey: tool.labelKey, route: tool.route, tone: tool.group, icon: tool.icon }));
}

export function routeIsActive(itemRoute: string, pathname: string, search: string): boolean {
  if (itemRoute === "/") return pathname === "/";
  const [itemPath, itemSearch] = itemRoute.split("?");
  if (pathname !== itemPath && !pathname.startsWith(`${itemPath}/`)) return false;
  return itemSearch ? search === `?${itemSearch}` : true;
}

export function toolGroupOfRoute(pathname: string, search: string): ToolGroup | undefined {
  const exact = toolShortcuts.find((item) => item.route === `${pathname}${search}`);
  if (exact) return exact.group;
  const navTone = toolNavigation.find((item) => item.route === pathname)?.tone;
  return navTone ?? toolShortcuts.find((item) => item.route.split("?")[0] === pathname)?.group;
}
