export type MermaidArt = { svg: string; width: number; height: number };

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type Attributes = Record<string, string>;
type TextRun = { point: Point; text: string; attributes: Attributes };
type MarkerSpec = { refX: number; refY: number; viewBox: Box | null; markerWidth: number; markerHeight: number; strokeUnits: boolean; orient: string };
type MarkerPlacement = { element: Element; marker: Element; transform: string };

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const TEXT_PARTS = new Set(["text", "tspan"]);
const DROPPED = new Set(["script", "iframe", "audio", "video", "animate", "animateMotion", "animateTransform", "set"]);
const STROKE_STYLE = ["stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "fill-rule"] as const;
const LINE_HEIGHT_EM = 1.2;
const TANGENT_STEP = 0.5;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
}

export function cssColor(value: string): { color: string; alpha: number } | null {
  const text = value.trim();
  if (!text) return null;
  if (text === "none" || text === "transparent") return { color: "none", alpha: 1 };
  const reference = /^url\(\s*["']?(#[^"')]+)["']?\s*\)/.exec(text);
  if (reference) return { color: `url(${reference[1]})`, alpha: 1 };
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text)) return { color: text.toLowerCase(), alpha: 1 };
  const functional = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (!functional) return null;
  const parts = functional[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map((part) => (part.endsWith("%") ? (parseFloat(part) * 255) / 100 : parseFloat(part)));
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const rawAlpha = parts[3];
  const alpha = rawAlpha === undefined ? 1 : rawAlpha.endsWith("%") ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha);
  if (!Number.isFinite(alpha) || alpha <= 0) return { color: "none", alpha: 1 };
  return { color: `#${channels.map(hex).join("")}`, alpha: Math.min(1, alpha) };
}

function length(value: string): string | null {
  const number = parseFloat(value);
  return Number.isFinite(number) ? String(round(number)) : null;
}

function dashes(value: string): string | null {
  if (!value || value === "none") return null;
  const numbers = value.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  return numbers.length && numbers.some((number) => number > 0) ? numbers.map(round).join(" ") : null;
}

function fontWeight(value: string): string {
  const number = parseInt(value, 10);
  if (Number.isFinite(number)) return number >= 600 ? "bold" : "normal";
  return value === "bold" || value === "bolder" ? "bold" : "normal";
}

function paint(style: CSSStyleDeclaration, attributes: Attributes, name: "fill" | "stroke"): void {
  const parsed = cssColor(style.getPropertyValue(name));
  if (!parsed) return;
  attributes[name] = parsed.color;
  const own = parseFloat(style.getPropertyValue(`${name}-opacity`));
  const opacity = (Number.isFinite(own) ? own : 1) * parsed.alpha;
  if (opacity < 1) attributes[`${name}-opacity`] = String(round(opacity));
}

function presentation(element: Element, style: CSSStyleDeclaration): Attributes {
  const name = element.localName;
  const attributes: Attributes = {};
  const opacity = parseFloat(style.getPropertyValue("opacity"));
  if (Number.isFinite(opacity) && opacity < 1) attributes.opacity = String(round(opacity));
  if (!SHAPES.has(name) && !TEXT_PARTS.has(name)) return attributes;
  paint(style, attributes, "fill");
  paint(style, attributes, "stroke");
  const width = length(style.getPropertyValue("stroke-width"));
  if (width !== null) attributes["stroke-width"] = width;
  const dash = dashes(style.getPropertyValue("stroke-dasharray"));
  if (dash) attributes["stroke-dasharray"] = dash;
  for (const property of STROKE_STYLE) {
    const value = style.getPropertyValue(property).trim();
    if (value) attributes[property] = value;
  }
  if (TEXT_PARTS.has(name)) {
    const family = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
    if (family) attributes["font-family"] = family;
    const size = length(style.getPropertyValue("font-size"));
    if (size !== null) attributes["font-size"] = size;
    attributes["font-weight"] = fontWeight(style.getPropertyValue("font-weight"));
    if (style.getPropertyValue("font-style") === "italic") attributes["font-style"] = "italic";
  }
  return attributes;
}

function hidden(style: CSSStyleDeclaration): boolean {
  return style.getPropertyValue("display") === "none" || ["hidden", "collapse"].includes(style.getPropertyValue("visibility"));
}

function scrub(root: Element): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (DROPPED.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
  }
}

function numberAttribute(element: Element, name: string, fallback: number): number {
  const value = parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function viewBoxOf(element: Element): Box | null {
  const parts = (element.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(parseFloat);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function lines(element: Element): string[] {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("br").forEach((line) => line.replaceWith("\n"));
  return (copy.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function replaceForeignObjects(root: Element): void {
  const view = root.ownerDocument.defaultView;
  for (const foreign of Array.from(root.querySelectorAll("foreignObject"))) {
    const content = lines(foreign);
    const label = root.ownerDocument.createElementNS(SVG_NS, "text");
    const x = numberAttribute(foreign, "x", 0) + numberAttribute(foreign, "width", 0) / 2;
    const y = numberAttribute(foreign, "y", 0) + numberAttribute(foreign, "height", 0) / 2;
    const inner = foreign.querySelector("span, div, p") ?? foreign.firstElementChild;
    const style = inner && view ? view.getComputedStyle(inner) : null;
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    if (style) {
      const color = cssColor(style.getPropertyValue("color"));
      if (color) label.setAttribute("fill", color.color);
      const size = length(style.getPropertyValue("font-size"));
      if (size !== null) label.setAttribute("font-size", size);
      label.setAttribute("font-family", style.getPropertyValue("font-family").replace(/["']/g, ""));
      label.setAttribute("font-weight", fontWeight(style.getPropertyValue("font-weight")));
    }
    content.forEach((line, index) => {
      const part = root.ownerDocument.createElementNS(SVG_NS, "tspan");
      part.setAttribute("x", String(round(x)));
      part.setAttribute("dy", `${index === 0 ? round((-(content.length - 1) / 2) * LINE_HEIGHT_EM) : LINE_HEIGHT_EM}em`);
      part.textContent = line;
      label.appendChild(part);
    });
    label.setAttribute("x", String(round(x)));
    label.setAttribute("y", String(round(y)));
    const transform = foreign.getAttribute("transform");
    if (transform) label.setAttribute("transform", transform);
    foreign.replaceWith(label);
  }
}

function textLeaves(text: Element): Element[] {
  const leaves = [text, ...Array.from(text.querySelectorAll("tspan"))].filter((element) => element.childElementCount === 0);
  return leaves.filter((element) => (element.textContent ?? "").trim());
}

function textRuns(text: Element, styles: Map<Element, Attributes>): TextRun[] {
  const runs: TextRun[] = [];
  for (const leaf of textLeaves(text)) {
    const content = leaf as unknown as SVGTextContentElement;
    const raw = leaf.textContent ?? "";
    const trimmed = raw.replace(/\s+/g, " ").trim();
    const count = content.getNumberOfChars();
    if (!trimmed || count <= 0) continue;
    const lead = /^\s/.test(raw) && count > trimmed.length ? 1 : 0;
    const start = content.getStartPositionOfChar(Math.min(lead, count - 1));
    runs.push({ point: { x: start.x, y: start.y }, text: trimmed, attributes: styles.get(leaf) ?? styles.get(text) ?? {} });
  }
  return runs;
}

function markerSpec(marker: Element): MarkerSpec {
  return {
    refX: numberAttribute(marker, "refX", 0),
    refY: numberAttribute(marker, "refY", 0),
    viewBox: viewBoxOf(marker),
    markerWidth: numberAttribute(marker, "markerWidth", 3),
    markerHeight: numberAttribute(marker, "markerHeight", 3),
    strokeUnits: marker.getAttribute("markerUnits") !== "userSpaceOnUse",
    orient: marker.getAttribute("orient") ?? "0",
  };
}

export function markerTransform(spec: MarkerSpec, at: Point, direction: number, end: "start" | "end", strokeWidth: number): string {
  let angle = parseFloat(spec.orient);
  if (spec.orient === "auto") angle = direction;
  else if (spec.orient === "auto-start-reverse") angle = end === "start" ? direction + 180 : direction;
  else if (!Number.isFinite(angle)) angle = 0;
  const fit = spec.viewBox ? Math.min(spec.markerWidth / spec.viewBox.width, spec.markerHeight / spec.viewBox.height) : 1;
  const scale = fit * (spec.strokeUnits ? strokeWidth : 1);
  return `translate(${round(at.x)} ${round(at.y)}) rotate(${round(angle)}) scale(${round(scale)}) translate(${round(-spec.refX)} ${round(-spec.refY)})`;
}

function markerId(value: string | null): string | null {
  const match = value ? /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value) : null;
  return match ? match[1] : null;
}

function placements(root: Element, view: Window): MarkerPlacement[] {
  const markers = new Map(Array.from(root.querySelectorAll("marker")).map((marker) => [marker.id, marker] as const));
  if (!markers.size) return [];
  const placed: MarkerPlacement[] = [];
  for (const element of Array.from(root.querySelectorAll("path, line, polyline, polygon"))) {
    const style = view.getComputedStyle(element);
    const geometry = element as unknown as SVGGeometryElement;
    for (const end of ["start", "end"] as const) {
      const id = markerId(element.getAttribute(`marker-${end}`) ?? style.getPropertyValue(`marker-${end}`));
      const marker = id ? markers.get(id) : undefined;
      if (!marker || typeof geometry.getTotalLength !== "function") continue;
      const total = geometry.getTotalLength();
      if (!(total > 0)) continue;
      const step = Math.min(TANGENT_STEP, total / 2);
      const at = geometry.getPointAtLength(end === "end" ? total : 0);
      const near = geometry.getPointAtLength(end === "end" ? total - step : step);
      const direction = end === "end" ? Math.atan2(at.y - near.y, at.x - near.x) : Math.atan2(near.y - at.y, near.x - at.x);
      const strokeWidth = parseFloat(style.getPropertyValue("stroke-width"));
      const transform = markerTransform(markerSpec(marker), at, (direction * 180) / Math.PI, end, Number.isFinite(strokeWidth) ? strokeWidth : 1);
      const own = element.getAttribute("transform");
      placed.push({ element, marker, transform: own ? `${own} ${transform}` : transform });
    }
  }
  return placed;
}

function placeMarker(placement: MarkerPlacement): void {
  const group = placement.element.ownerDocument.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", placement.transform);
  for (const child of Array.from(placement.marker.children)) group.appendChild(child.cloneNode(true));
  placement.element.after(group);
  placement.element.removeAttribute("marker-start");
  placement.element.removeAttribute("marker-end");
  placement.element.removeAttribute("marker-mid");
}

function replaceText(text: Element, runs: TextRun[]): void {
  const transform = text.getAttribute("transform");
  for (const run of runs) {
    const label = text.ownerDocument.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(round(run.point.x)));
    label.setAttribute("y", String(round(run.point.y)));
    for (const [name, value] of Object.entries(run.attributes)) label.setAttribute(name, value);
    if (transform) label.setAttribute("transform", transform);
    label.textContent = run.text;
    text.before(label);
  }
  text.remove();
}

function sizeOf(root: SVGSVGElement): { width: number; height: number } | null {
  const box = viewBoxOf(root);
  if (box) return { width: box.width, height: box.height };
  const width = numberAttribute(root, "width", 0);
  const height = numberAttribute(root, "height", 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function normalizeMermaidSvg(markup: string, doc: Document = document): MermaidArt | null {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const source = parsed.documentElement;
  const view = doc.defaultView;
  if (!view || source.localName !== "svg" || parsed.getElementsByTagName("parsererror").length) return null;
  scrub(source);
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", opacity: "0", pointerEvents: "none" });
  const root = doc.importNode(source, true) as unknown as SVGSVGElement;
  host.appendChild(root);
  doc.body.appendChild(host);
  try {
    replaceForeignObjects(root);
    const styles = new Map<Element, Attributes>();
    const invisible: Element[] = [];
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.localName === "style") continue;
      const style = view.getComputedStyle(element);
      if (hidden(style) && !element.closest("marker, defs")) invisible.push(element);
      else styles.set(element, presentation(element, style));
    }
    const texts = Array.from(root.querySelectorAll("text"))
      .filter((text) => !invisible.some((element) => element.contains(text)))
      .map((text) => ({ text, runs: textRuns(text, styles) }));
    const marked = placements(root, view);
    for (const [element, attributes] of styles) {
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    }
    marked.forEach(placeMarker);
    texts.forEach(({ text, runs }) => replaceText(text, runs));
    invisible.forEach((element) => element.remove());
    root.querySelectorAll("style, marker").forEach((element) => element.remove());
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      element.removeAttribute("class");
      element.removeAttribute("style");
    }
    const size = sizeOf(root);
    if (!size) return null;
    root.setAttribute("width", String(round(size.width)));
    root.setAttribute("height", String(round(size.height)));
    return { svg: new XMLSerializer().serializeToString(root), width: size.width, height: size.height };
  } finally {
    host.remove();
  }
}
