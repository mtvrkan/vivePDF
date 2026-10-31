import { describe, expect, it } from "vitest";
import type { PdfInkListObject } from "@embedpdf/models";
import { createInkJoiner, straighten, type InkEditor } from "./inkHandler";
import type { InkTarget } from "./inkSession";

const pen = { toolId: "ink", strokeColor: "#E44234", strokeWidth: 4 };
const stroke = (x: number): PdfInkListObject[] => [{ points: [{ x, y: 10 }, { x: x + 5, y: 30 }] }];

function fakeEditor() {
  const drawings = new Map<string, InkTarget>();
  const editor: InkEditor = {
    find: (id) => drawings.get(id) ?? null,
    update: (_, id, patch) => {
      const current = drawings.get(id);
      if (current) drawings.set(id, { ...current, inkList: patch.inkList });
    },
  };
  const create = (strokes: PdfInkListObject[]) => (id: string) => drawings.set(id, { strokeColor: pen.strokeColor, strokeWidth: pen.strokeWidth, inkList: strokes });
  return { drawings, editor, create };
}

describe("pen drawing until the tool changes", () => {
  it("puts every stroke on one page into the same drawing", () => {
    const { drawings, editor, create } = fakeEditor();
    const joiner = createInkJoiner();
    joiner.bind(editor);

    for (const x of [10, 40, 70]) joiner.place(0, stroke(x), pen, create(stroke(x)));

    expect([...drawings.values()].map((drawing) => drawing.inkList.length)).toEqual([3]);
  });

  it("starts a new drawing after end, on another page or after the drawing was deleted", () => {
    const { drawings, editor, create } = fakeEditor();
    const joiner = createInkJoiner();
    joiner.bind(editor);

    joiner.place(0, stroke(10), pen, create(stroke(10)));
    joiner.end();
    joiner.place(0, stroke(40), pen, create(stroke(40)));
    joiner.place(1, stroke(70), pen, create(stroke(70)));
    drawings.clear();
    joiner.place(1, stroke(90), pen, create(stroke(90)));

    expect(drawings.size).toBe(1);
  });

  it("creates a new drawing every time while no document is bound", () => {
    const created: string[] = [];
    const joiner = createInkJoiner();

    joiner.place(0, stroke(10), pen, (id) => created.push(id));
    joiner.place(0, stroke(40), pen, (id) => created.push(id));

    expect(new Set(created).size).toBe(2);
  });
});

describe("straightening marker lines", () => {
  it("lays a nearly flat line exactly flat", () => {
    const line = straighten([
      { x: 0, y: 10 },
      { x: 50, y: 12 },
      { x: 100, y: 11 },
    ]);

    expect(line).toEqual([
      { x: 0, y: 11 },
      { x: 100, y: 11 },
    ]);
  });

  it("leaves a curve alone", () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 0 },
    ];

    expect(straighten(curve)).toBe(curve);
  });
});
