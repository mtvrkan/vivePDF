import { readFileSync } from "node:fs";
import { transformWithEsbuild, type Plugin } from "vite";

type Node = { type: string; start: number; end: number; [key: string]: unknown };

export type BlobWorker = { start: number; end: number; source: string };

const ENGINE_RANGE_GLOBAL = "VivePdfRange";

const ENGINE_MODULE = /@embedpdf[\\/]engines[\\/]dist[\\/]lib[\\/]pdfium[\\/]web[\\/]worker-engine\.js$/;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

function stringValue(node: Node): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    const [quasi] = node.quasis as { value: { cooked: string } }[];
    return quasi.value.cooked;
  }
  return null;
}

function blobWorkerOf(node: Node): BlobWorker | null {
  if (node.type !== "CallExpression") return null;
  const callee = node.callee as Node;
  if (callee.type !== "MemberExpression") return null;
  const object = callee.object as Node;
  const property = callee.property as Node;
  if (object.type !== "Identifier" || object.name !== "URL" || property.name !== "createObjectURL") return null;
  const [blob] = node.arguments as Node[];
  if (!blob || blob.type !== "NewExpression" || (blob.callee as Node).name !== "Blob") return null;
  const [parts] = blob.arguments as Node[];
  if (!parts || parts.type !== "ArrayExpression") return null;
  const elements = parts.elements as Node[];
  if (elements.length !== 1) return null;
  const source = stringValue(elements[0]);
  return source === null ? null : { start: node.start, end: node.end, source };
}

export function findBlobWorkers(ast: unknown): BlobWorker[] {
  const found: BlobWorker[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNode(value)) return;
    const worker = blobWorkerOf(value);
    if (worker) {
      found.push(worker);
      return;
    }
    for (const [key, child] of Object.entries(value)) if (key !== "type" && typeof child === "object") visit(child);
  };
  visit(ast);
  return found;
}

export function workerFileName(source: string): string {
  return source.includes("wasmInit") ? "engine-worker.js" : "encoder-worker.js";
}

export function extractWorkers(assetsModule: string, engineRangeModule: string): Plugin {
  let serving = false;
  return {
    name: "vivepdf-embed-extract-workers",
    configResolved(config) {
      serving = config.command === "serve";
    },
    async transform(code, id) {
      if (!ENGINE_MODULE.test(id)) return null;
      const workers = findBlobWorkers(this.parse(code));
      const names = workers.map((worker) => workerFileName(worker.source));
      if (workers.length !== 2 || new Set(names).size !== 2) this.error(`expected the engine and encoder worker blobs in ${id}, found ${names.join(", ") || "none"}`);
      this.addWatchFile(engineRangeModule);
      const range = await transformWithEsbuild(readFileSync(engineRangeModule, "utf8"), engineRangeModule, { format: "iife", globalName: ENGINE_RANGE_GLOBAL, target: "es2022" });
      let output = code;
      for (const worker of [...workers].sort((a, b) => b.start - a.start)) {
        const fileName = workerFileName(worker.source);
        const source = fileName === "engine-worker.js" ? `${range.code}\n${worker.source}` : worker.source;
        if (serving) {
          output = `${output.slice(0, worker.start)}URL.createObjectURL(new Blob([${JSON.stringify(source)}], { type: "application/javascript" }))${output.slice(worker.end)}`;
          continue;
        }
        const minified = await transformWithEsbuild(source, fileName, { minify: true, format: "esm", target: "es2022", legalComments: "none" });
        this.emitFile({ type: "asset", fileName, source: minified.code });
        output = `${output.slice(0, worker.start)}__vivepdfWorkerUrl(${JSON.stringify(fileName)})${output.slice(worker.end)}`;
      }
      if (serving) return { code: output, map: null };
      return { code: `import { workerUrl as __vivepdfWorkerUrl } from ${JSON.stringify(assetsModule)};\n${output}`, map: null };
    },
  };
}
