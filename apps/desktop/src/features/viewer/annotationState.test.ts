import { describe, expect, it } from "vitest";
import { annotationStateOf } from "./annotationState";

describe("annotationStateOf", () => {
  it("returns the state of an open document", () => {
    const state = { selectedUids: ["a"] };
    expect(annotationStateOf({ getState: () => state })).toBe(state);
  });

  it("returns null once the document has been closed", () => {
    const closed = {
      getState: (): { selectedUids: string[] } => {
        throw new Error("Annotation state not found for document: closed-id");
      },
    };
    expect(annotationStateOf(closed)).toBeNull();
  });

  it("passes any other failure on", () => {
    const broken = {
      getState: (): unknown => {
        throw new Error("engine crashed");
      },
    };
    expect(() => annotationStateOf(broken)).toThrow("engine crashed");
  });
});
