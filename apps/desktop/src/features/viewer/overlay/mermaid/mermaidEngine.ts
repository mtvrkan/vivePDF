import mermaid from "mermaid";
import { cleanMermaid, errorLine, type MermaidTheme } from "./mermaidModel";
import { normalizeMermaidSvg, type MermaidArt } from "./mermaidSvg";

export type MermaidFailure = { error: "empty" | "invalid" | "drawFailed"; message: string; line: number | null };
export type MermaidDrawing = MermaidArt | MermaidFailure;

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const HTML_LABEL_DIAGRAMS = new Set(["mindmap"]);

let queue: Promise<unknown> = Promise.resolve();
let renders = 0;

function configure(theme: MermaidTheme, htmlLabels = false): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    fontFamily: FONT_FAMILY,
    themeVariables: { fontFamily: FONT_FAMILY },
    htmlLabels,
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
    deterministicIds: true,
  });
}

function messageOf(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  return message.slice(0, 600);
}

function failed(error: MermaidFailure["error"], failure: unknown): MermaidFailure {
  const message = messageOf(failure);
  return { error, message, line: errorLine(message) };
}

async function draw(code: string, theme: MermaidTheme): Promise<MermaidDrawing> {
  const source = cleanMermaid(code);
  if (!source) return { error: "empty", message: "", line: null };
  configure(theme);
  let diagramType: string;
  try {
    const parsed = await mermaid.parse(source);
    diagramType = parsed ? parsed.diagramType : "";
  } catch (failure) {
    const result = failed("invalid", failure);
    return result.line === null ? result : { ...result, line: Math.min(result.line, source.split("\n").length) };
  }
  if (HTML_LABEL_DIAGRAMS.has(diagramType)) configure(theme, true);
  try {
    renders += 1;
    const { svg } = await mermaid.render(`vivepdf-mermaid-${renders}`, source);
    return normalizeMermaidSvg(svg) ?? { error: "drawFailed", message: "", line: null };
  } catch (failure) {
    return failed("drawFailed", failure);
  }
}

export function drawMermaid(code: string, theme: MermaidTheme): Promise<MermaidDrawing> {
  const run = queue.then(() => draw(code, theme));
  queue = run.catch(() => undefined);
  return run;
}
