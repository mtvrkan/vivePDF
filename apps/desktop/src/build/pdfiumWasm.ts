import type { Plugin } from "vite";

const PACKAGE_MARK = "@embedpdf/pdfium";
const PACKAGED_URL = /new URL\(\s*(["'])pdfium\.wasm\1\s*,\s*import\.meta\.url\s*\)/g;
const PUBLIC_URL = 'new URL("/pdfium.wasm", self.location.origin)';
const HASHED_COPY = /(^|\/)pdfium-[^/]*\.wasm$/;

export function pointAtPublicPdfium(code: string): string | null {
  const pointed = code.replace(PACKAGED_URL, PUBLIC_URL);
  return pointed === code ? null : pointed;
}

export function hashedPdfiumCopies(fileNames: string[]): string[] {
  return fileNames.filter((name) => HASHED_COPY.test(name));
}

export function pdfiumWasmOnce(): Plugin {
  return {
    name: "vivepdf-pdfium-wasm-once",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(PACKAGE_MARK)) return null;
      const pointed = pointAtPublicPdfium(code);
      return pointed === null ? null : { code: pointed, map: null };
    },
    generateBundle(_options, bundle) {
      const copies = hashedPdfiumCopies(Object.keys(bundle));
      if (copies.length > 0) this.error(`pdfium.wasm is bundled a second time as ${copies.join(", ")}; the app loads public/pdfium.wasm, so point the package's own URL at it again`);
    },
  };
}
