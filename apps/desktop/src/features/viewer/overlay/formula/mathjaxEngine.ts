import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js";
import "@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js";
import "@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js";
import "@mathjax/src/js/input/tex/bbox/BboxConfiguration.js";
import "@mathjax/src/js/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/js/input/tex/bussproofs/BussproofsConfiguration.js";
import "@mathjax/src/js/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js";
import "@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js";
import "@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js";
import "@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js";
import "@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/units/UnitsConfiguration.js";
import "@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import { MathJaxMhchemFontExtension } from "@mathjax/mathjax-mhchem-font-extension/js/svg.js";
import { standaloneTableLines } from "./formulaSvg";

const FONT_PREFIX = "@mathjax/mathjax-newcm-font/js/svg/dynamic/";
export const FONT_FILES: Record<string, () => Promise<unknown>> = {
  latin: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js"),
  "latin-b": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js"),
  "latin-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js"),
  "latin-bi": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js"),
  "double-struck": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js"),
  fraktur: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js"),
  script: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js"),
  "sans-serif": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js"),
  "sans-serif-r": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js"),
  "sans-serif-b": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js"),
  "sans-serif-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js"),
  "sans-serif-bi": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js"),
  "sans-serif-ex": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js"),
  monospace: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js"),
  "monospace-l": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js"),
  "monospace-ex": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js"),
  calligraphic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js"),
  math: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js"),
  symbols: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js"),
  "symbols-b-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js"),
  greek: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js"),
  "greek-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js"),
  cyrillic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js"),
  "cyrillic-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js"),
  phonetics: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js"),
  "phonetics-ss": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js"),
  hebrew: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js"),
  devanagari: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js"),
  cherokee: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js"),
  arabic: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js"),
  "braille-d": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js"),
  braille: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js"),
  arrows: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js"),
  marrows: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js"),
  accents: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js"),
  "accents-b-i": () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js"),
  shapes: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js"),
  mshapes: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js"),
  variants: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js"),
  PUA: () => import("@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js"),
};

export type TypesetResult = { svg: string; emWidth: number; emHeight: number } | { error: string };

export function fontFileKey(name: string): string | null {
  if (!name.startsWith(FONT_PREFIX)) return null;
  return name.slice(FONT_PREFIX.length).replace(/\.js$/, "");
}

function loadFontFile(name: string): Promise<unknown> {
  const key = fontFileKey(name);
  const loader = key ? FONT_FILES[key] : undefined;
  if (!loader) return Promise.reject(new Error(`unknown MathJax file ${name}`));
  return loader();
}

MathJaxNewcmFont.addExtension(MathJaxMhchemFontExtension);
mathjax.asyncLoad = loadFontFile;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

let parseError: string | null = null;
const tex = new TeX({
  packages: ["base", "ams", "amscd", "bbox", "boldsymbol", "braket", "bussproofs", "cancel", "cases", "centernot", "color", "colortbl", "empheq", "enclose", "extpfeil", "gensymb", "mathtools", "mhchem", "newcommand", "physics", "textcomp", "textmacros", "units", "upgreek"],
  formatError: (jax: { formatError: (error: Error) => unknown }, error: Error) => {
    parseError = error.message;
    return jax.formatError(error);
  },
});
const output = new SVG({ fontCache: "none", fontData: MathJaxNewcmFont });
const mathDocument = mathjax.document("", { InputJax: tex, OutputJax: output });

function viewBoxSize(svg: string): { width: number; height: number } | null {
  const match = /viewBox="([^"]+)"/.exec(svg);
  if (!match) return null;
  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { width: parts[2], height: parts[3] };
}

type LiteNode = Parameters<typeof adaptor.getAttribute>[0];

function numbersOf(value: string | null | undefined): number[] {
  return (value ?? "").trim().split(/[\s,]+/).map(Number);
}

function fixLabelledLayout(root: LiteNode): void {
  const box = adaptor.getAttribute(root, "data-mjx-viewBox");
  if (!box) return;
  const [minX, , width] = numbersOf(box);
  adaptor.setAttribute(root, "viewBox", box);
  adaptor.removeAttribute(root, "data-mjx-viewBox");
  adaptor.removeAttribute(root, "width");
  adaptor.removeAttribute(root, "style");
  const nested = adaptor.tags(root, "svg").filter((item) => adaptor.getAttribute(item, "data-table") || adaptor.getAttribute(item, "data-labels"));
  for (const item of nested) {
    const view = numbersOf(adaptor.getAttribute(item, "viewBox"));
    if (view.length !== 4 || !view.every(Number.isFinite)) continue;
    const align = adaptor.getAttribute(item, "preserveAspectRatio") ?? "";
    const left = align.startsWith("xMid") ? minX + (width - view[2]) / 2 : align.startsWith("xMax") ? minX + width - view[2] : minX;
    const group = adaptor.node("g", { transform: `translate(${Math.round((left - view[0]) * 100) / 100} 0)` }, [...adaptor.childNodes(item)]);
    adaptor.replace(group, item);
  }
}

let queue: Promise<unknown> = Promise.resolve();

export function typeset(latex: string): Promise<TypesetResult> {
  const run = queue.then(async (): Promise<TypesetResult> => {
    parseError = null;
    const node = await mathDocument.convertPromise(latex, { display: true });
    const error = parseError as string | null;
    if (error) return { error };
    const root = adaptor.firstChild(node) as LiteNode;
    fixLabelledLayout(root);
    const svg = standaloneTableLines(adaptor.serializeXML(root as never));
    const size = viewBoxSize(svg);
    if (!size) return { error: "empty" };
    return { svg, emWidth: size.width / 1000, emHeight: size.height / 1000 };
  });
  queue = run.catch(() => undefined);
  return run;
}
