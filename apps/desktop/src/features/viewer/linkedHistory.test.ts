import { beforeEach, describe, expect, it } from "vitest";
import { forgetReplacements, linkReplacement, redoStep, undoStep } from "./linkedHistory";

type Action = { add?: string; remove?: string };

function fakeEditor(initial: string[]) {
  const present = new Set(initial);
  const done: Action[] = [];
  const undone: Action[] = [];
  const apply = (action: Action, reverse: boolean) => {
    const add = reverse ? action.remove : action.add;
    const remove = reverse ? action.add : action.remove;
    if (remove) present.delete(remove);
    if (add) present.add(add);
  };
  return {
    present,
    act(action: Action) {
      apply(action, false);
      done.push(action);
      undone.length = 0;
    },
    history: {
      undo: () => {
        const action = done.pop();
        if (!action) return;
        apply(action, true);
        undone.push(action);
      },
      redo: () => {
        const action = undone.pop();
        if (!action) return;
        apply(action, false);
        done.push(action);
      },
      canUndo: () => done.length > 0,
      canRedo: () => undone.length > 0,
    },
    lookup: { getAnnotationById: (id: string) => (present.has(id) ? { id } : null) },
  };
}

function convert(editor: ReturnType<typeof fakeEditor>) {
  editor.act({ remove: "line" });
  editor.act({ add: "curve" });
  linkReplacement("doc", "line", "curve");
}

beforeEach(() => forgetReplacements("doc"));

describe("linked history steps", () => {
  it("undoes and redoes a line turned into a curve as one step", () => {
    const editor = fakeEditor(["line", "other"]);
    convert(editor);

    undoStep("doc", editor.history, editor.lookup);

    expect([...editor.present].sort()).toEqual(["line", "other"]);

    redoStep("doc", editor.history, editor.lookup);

    expect([...editor.present].sort()).toEqual(["curve", "other"]);
  });

  it("leaves later steps alone when the curve was deleted afterwards", () => {
    const editor = fakeEditor(["line"]);
    convert(editor);
    editor.act({ remove: "curve" });
    editor.act({ add: "ink" });

    undoStep("doc", editor.history, editor.lookup);
    expect([...editor.present]).toEqual([]);

    undoStep("doc", editor.history, editor.lookup);
    expect([...editor.present]).toEqual(["curve"]);
  });

  it("steps once for unlinked documents and after the links are forgotten", () => {
    const editor = fakeEditor(["line"]);
    convert(editor);
    forgetReplacements("doc");

    undoStep("doc", editor.history, editor.lookup);

    expect([...editor.present]).toEqual([]);
    expect(() => undoStep("doc", null, null)).not.toThrow();
  });
});
