import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { findBlobWorkers, workerFileName } from "./extractWorkers";

const ENGINE_SOURCE = 'self.onmessage = (event) => { if (event.data.type === "wasmInit") run(); };';
const ENCODER_SOURCE = "self.onmessage = () => encode();";

describe("findBlobWorkers", () => {
  it("finds the engine string and the encoder template with their exact spans", () => {
    const code = [
      `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(ENGINE_SOURCE)}], { type: "application/javascript" })), { type: "module" });`,
      `const encoder = URL.createObjectURL(new Blob([\`${ENCODER_SOURCE}\`], { type: "application/javascript" }));`,
    ].join("\n");

    const workers = findBlobWorkers(parseAst(code));

    expect(workers.map((worker) => worker.source)).toEqual([ENGINE_SOURCE, ENCODER_SOURCE]);
    for (const worker of workers) expect(code.slice(worker.start, worker.end)).toMatch(/^URL\.createObjectURL\(new Blob\(\[.*\], \{ type: "application\/javascript" \}\)\)$/s);
  });

  it("leaves a blob built from a variable alone", () => {
    const code = "const url = URL.createObjectURL(new Blob([source]));";

    const workers = findBlobWorkers(parseAst(code));

    expect(workers).toEqual([]);
  });

  it("leaves a template with expressions alone", () => {
    const code = "const url = URL.createObjectURL(new Blob([`import ${name}`]));";

    const workers = findBlobWorkers(parseAst(code));

    expect(workers).toEqual([]);
  });
});

describe("workerFileName", () => {
  it("names the engine and encoder workers apart", () => {
    const names = [ENGINE_SOURCE, ENCODER_SOURCE].map(workerFileName);

    expect(names).toEqual(["engine-worker.js", "encoder-worker.js"]);
  });
});
