import { describe, expect, it } from "vitest";
import { ANNOTATE_MESSAGES } from "./messages";
import { ANNOTATE_TOOLS, ANNOTATION_COLORS, STROKE_WIDTHS } from "./tools";

describe("drawing tool messages", () => {
  it("names every tool, colour and width in both languages", () => {
    const counts = Object.values(ANNOTATE_MESSAGES).map((messages) => [Object.keys(messages.tools).sort(), messages.colorNames.length, messages.widthNames.length]);

    for (const count of counts) expect(count).toEqual([[...ANNOTATE_TOOLS].sort(), ANNOTATION_COLORS.length, STROKE_WIDTHS.length]);
  });

  it("leaves no text empty", () => {
    const texts = Object.values(ANNOTATE_MESSAGES).flatMap((messages) => [messages.bar, messages.colors, messages.width, messages.undo, messages.redo, messages.remove, messages.close, messages.textHint, messages.noteLabel, messages.notePlaceholder, ...Object.values(messages.tools), ...messages.colorNames, ...messages.widthNames]);

    expect(texts.every((text) => text.trim().length > 0)).toBe(true);
  });

  it("is a separate language table from the viewer strings", () => {
    const languages = Object.keys(ANNOTATE_MESSAGES).sort();

    expect(languages).toEqual(["en", "tr"]);
  });
});
