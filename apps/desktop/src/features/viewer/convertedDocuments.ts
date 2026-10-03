import { create } from "zustand";
import { EBOOK_EXTENSIONS, IMAGE_EXTENSIONS, MAIL_EXTENSIONS, OFFICE_LIKE_EXTENSIONS, TEXT_LIKE_EXTENSIONS } from "@/features/tools/convert/conversions";
import { extensionOf, pathKey } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";

export const OPEN_CONVERTIBLE_EXTENSIONS = [...new Set([...OFFICE_LIKE_EXTENSIONS, ...TEXT_LIKE_EXTENSIONS, ...EBOOK_EXTENSIONS, ...MAIL_EXTENSIONS, ...IMAGE_EXTENSIONS])];

export function isConvertibleOnOpen(path: string): boolean {
  return OPEN_CONVERTIBLE_EXTENSIONS.includes(extensionOf(path));
}

export function isOpenablePath(path: string): boolean {
  return isPdfPath(path) || isConvertibleOnOpen(path);
}

type ConvertedState = {
  originals: Record<string, string>;
  remember: (pdfPath: string, originalPath: string) => void;
  forget: (pdfPath: string) => void;
};

export const useConvertedStore = create<ConvertedState>((set) => ({
  originals: {},
  remember: (pdfPath, originalPath) => set((state) => ({ originals: { ...state.originals, [pathKey(pdfPath)]: originalPath } })),
  forget: (pdfPath) =>
    set((state) => {
      const key = pathKey(pdfPath);
      if (!(key in state.originals)) return state;
      const originals = { ...state.originals };
      delete originals[key];
      return { originals };
    }),
}));

export function originalOf(pdfPath: string): string | null {
  return useConvertedStore.getState().originals[pathKey(pdfPath)] ?? null;
}

export function sessionPathOf(path: string): string {
  return originalOf(path) ?? path;
}

export function convertedCopyOf(originalPath: string): string | null {
  const wanted = pathKey(originalPath);
  const entry = Object.entries(useConvertedStore.getState().originals).find(([, original]) => pathKey(original) === wanted);
  return entry ? entry[0] : null;
}
