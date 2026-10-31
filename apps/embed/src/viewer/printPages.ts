import { PRINT_ROOT_CLASS, fitInto, printSheetCss, type Size } from "./printLayout";

export type PrintPage = { url: string | null; size: Size };
export type PrintJob = { dispose: () => void };

function loaded(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

export async function printPages(pages: PrintPage[], sheet: Size, stillWanted: () => boolean): Promise<PrintJob | null> {
  const style = new CSSStyleSheet();
  style.replaceSync(printSheetCss(sheet));
  const root = document.createElement("div");
  root.className = PRINT_ROOT_CLASS;
  root.setAttribute("aria-hidden", "true");
  const waits: Promise<void>[] = [];
  const placed: { image: HTMLImageElement; size: Size }[] = [];
  for (const page of pages) {
    const sheetBox = document.createElement("div");
    if (page.url) {
      const image = new Image();
      image.alt = "";
      waits.push(loaded(image));
      image.src = page.url;
      placed.push({ image, size: page.size });
      sheetBox.append(image);
    }
    root.append(sheetBox);
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("afterprint", dispose);
    root.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheetStyle) => sheetStyle !== style);
    for (const page of pages) if (page.url) URL.revokeObjectURL(page.url);
  };
  document.body.append(root);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];
  await Promise.all(waits);
  if (!stillWanted()) {
    dispose();
    return null;
  }
  for (const { image, size } of placed) {
    const natural = image.naturalWidth > 0 && image.naturalHeight > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : size;
    const fitted = fitInto(natural, sheet);
    image.style.width = `${fitted.width}pt`;
    image.style.height = `${fitted.height}pt`;
  }
  window.addEventListener("afterprint", dispose);
  window.print();
  return { dispose };
}
