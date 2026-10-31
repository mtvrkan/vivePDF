import { describe, expect, it } from "vitest";
import { annotateError } from "../api/errors";
import { answerAnnotate } from "./annotateCommands";
import type { AnnotateApi, AnnotateCommand } from "./bridge";

function settled<T>(build: (reply: { resolve: (value: T) => void; reject: (error: Error) => void }) => AnnotateCommand, api: AnnotateApi | null): Promise<string> {
  return new Promise((done) => {
    answerAnnotate(
      api,
      build({
        resolve: (value) => done(`ok ${JSON.stringify(value ?? null)}`),
        reject: (error) => done(`${(error as Error & { code: string }).code} ${error.message}`),
      }),
    );
  });
}

function fakeApi(overrides: Partial<AnnotateApi> = {}): AnnotateApi & { tools: unknown[] } {
  const tools: unknown[] = [];
  return { list: () => [], replace: () => {}, save: async () => new Blob(["%PDF"]), chooseTool: (tool) => tools.push(tool), tools, ...overrides };
}

describe("answerAnnotate", () => {
  it("answers the list, a replacement and a save", async () => {
    const api = fakeApi({ list: () => [{ type: "note", page: 1, color: "#FFCD45", box: { x: 1, y: 2, width: 3, height: 4 } }] });

    const answers = await Promise.all([
      settled((reply) => ({ kind: "annotations", reply }), api),
      settled((reply) => ({ kind: "setAnnotations", list: [], reply }), api),
      settled<Blob>((reply) => ({ kind: "save", reply }), api).then((answer) => answer.slice(0, 2)),
    ]);

    expect(answers).toEqual(['ok [{"type":"note","page":1,"color":"#FFCD45","box":{"x":1,"y":2,"width":3,"height":4}}]', "ok null", "ok"]);
  });

  it("says the tools are off when the viewer has no drawing session, and ignores a tool choice", async () => {
    const answer = await settled((reply) => ({ kind: "annotations", reply }), null);

    answerAnnotate(null, { kind: "setTool", tool: "pen" });

    expect(answer).toBe("annotate-off vive-pdf: the drawing tools are off; add the annotate attribute");
  });

  it("passes on a coded error from the session and wraps any other failure", async () => {
    const answers = await Promise.all([
      settled((reply) => ({ kind: "setAnnotations", list: 3, reply }), fakeApi({ replace: () => { throw annotateError("invalid", "setAnnotations needs a list"); } })),
      settled<Blob>((reply) => ({ kind: "save", reply }), fakeApi({ save: () => Promise.reject(new Error("disk full")) })),
    ]);

    expect(answers).toEqual(["invalid vive-pdf: setAnnotations needs a list", "failed vive-pdf: disk full"]);
  });

  it("hands a tool choice to the session", () => {
    const api = fakeApi();

    answerAnnotate(api, { kind: "setTool", tool: "ellipse" });

    expect(api.tools).toEqual(["ellipse"]);
  });
});
