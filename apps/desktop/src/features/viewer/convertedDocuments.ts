import { create } from "zustand";
import { EBOOK_EXTENSIONS, IMAGE_EXTENSIONS, MAIL_EXTENSIONS, OFFICE_LIKE_EXTENSIONS, TEXT_LIKE_EXTENSIONS } from "@/features/tools/convert/conversions";
import { extensionOf, pathKey } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";
import { isDesignPath } from "@/shared/store/studioLaunchStore";

export const OPEN_CONVERTIBLE_EXTENSIONS = [...new Set([...OFFICE_LIKE_EXTENSIONS, ...TEXT_LIKE_EXTENSIONS, ...EBOOK_EXTENSIONS, ...MAIL_EXTENSIONS, ...IMAGE_EXTENSIONS])];

export function isConvertibleOnOpen(path: string): boolean {
  return OPEN_CONVERTIBLE_EXTENSIONS.includes(extensionOf(path));
}

export function isOpenablePath(path: string): boolean {
  return isPdfPath(path) || isConvertibleOnOpen(path) || isDesignPath(path);
}

type ConvertedState = {
  originals: Record<string, string>;
  unsaved: Record<string, true>;
  remember: (pdfPath: string, originalPath: string) => void;
  rememberUnsaved: (pdfPath: string, suggestedPath: string) => void;
  forget: (pdfPath: string) => void;
};

export const useConvertedStore = create<ConvertedState>((set) => ({
  originals: {},
  unsaved: {},
  remember: (pdfPath, originalPath) => set((state) => ({ originals: { ...state.originals, [pathKey(pdfPath)]: originalPath } })),
  rememberUnsaved: (pdfPath, suggestedPath) =>
    set((state) => ({ originals: { ...state.originals, [pathKey(pdfPath)]: suggestedPath }, unsaved: { ...state.unsaved, [pathKey(pdfPath)]: true } })),
  forget: (pdfPath) =>
    set((state) => {
      const key = pathKey(pdfPath);
      if (!(key in state.originals)) return state;
      const originals = { ...state.originals };
      const unsaved = { ...state.unsaved };
      delete originals[key];
      delete unsaved[key];
      return { originals, unsaved };
    }),
}));

export function isUnsavedCopy(pdfPath: string): boolean {
  return useConvertedStore.getState().unsaved[pathKey(pdfPath)] === true;
}

export function originalOf(pdfPath: string): string | null {
  return useConvertedStore.getState().originals[pathKey(pdfPath)] ?? null;
}

export function sessionPathOf(path: string): string {
  if (isUnsavedCopy(path)) return path;
  return originalOf(path) ?? path;
}

export function convertedCopyOf(originalPath: string): string | null {
  const wanted = pathKey(originalPath);
  const { originals, unsaved } = useConvertedStore.getState();
  const entry = Object.entries(originals).find(([copy, original]) => !unsaved[copy] && pathKey(original) === wanted);
  return entry ? entry[0] : null;
}
