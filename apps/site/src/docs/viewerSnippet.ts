export const VIEWER_CDN = "https://cdn.jsdelivr.net/npm/@vivepdf/viewer@0/dist/vivepdf.js";

export const VIEWER_MODES = ["sized", "full", "inline", "lightbox"] as const;
export const VIEWER_THEMES = ["light", "dark", "auto"] as const;
export const VIEWER_LANGS = ["", "tr", "en"] as const;
export const VIEWER_ZOOMS = ["fit-width", "fit-page", "100", "150"] as const;
export const VIEWER_CONTROLS = ["toolbar", "search", "print", "download"] as const;
export const VIEWER_ACCENTS = ["", "#0F766E", "#7C3AED", "#C2410C", "#BE123C"] as const;

export type ViewerControl = (typeof VIEWER_CONTROLS)[number];

export type ViewerOptions = {
  mode: (typeof VIEWER_MODES)[number];
  theme: (typeof VIEWER_THEMES)[number];
  lang: (typeof VIEWER_LANGS)[number];
  zoom: (typeof VIEWER_ZOOMS)[number];
  page: number;
  accent: string;
  hidden: ViewerControl[];
};

export const VIEWER_DEFAULTS: ViewerOptions = { mode: "sized", theme: "light", lang: "", zoom: "fit-width", page: 1, accent: "", hidden: [] };

export type SnippetCopy = { src: string; open: string };

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function viewerAttributes(options: ViewerOptions): Array<[string, string]> {
  const attributes: Array<[string, string]> = [];
  if (options.mode !== VIEWER_DEFAULTS.mode) attributes.push(["mode", options.mode]);
  if (options.page > 1) attributes.push(["page", String(Math.floor(options.page))]);
  if (options.zoom !== VIEWER_DEFAULTS.zoom) attributes.push(["zoom", options.zoom]);
  if (options.theme !== VIEWER_DEFAULTS.theme) attributes.push(["theme", options.theme]);
  if (options.lang) attributes.push(["lang", options.lang]);
  if (options.accent) attributes.push(["accent", options.accent]);
  for (const control of VIEWER_CONTROLS) if (options.hidden.includes(control)) attributes.push([control, "false"]);
  return attributes;
}

export function viewerSnippet(options: ViewerOptions, copy: SnippetCopy): string {
  const attributes = [["src", copy.src], ...viewerAttributes(options)].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
  const script = `<script src="${VIEWER_CDN}"></script>`;
  if (options.mode !== "lightbox") return `${script}\n<vive-pdf${attributes}></vive-pdf>`;
  return [
    script,
    `<button type="button" id="open-pdf">${escapeAttribute(copy.open)}</button>`,
    `<vive-pdf id="pdf"${attributes}></vive-pdf>`,
    "<script>",
    `  document.getElementById("open-pdf").addEventListener("click", () => document.getElementById("pdf").show());`,
    "</script>",
  ].join("\n");
}
