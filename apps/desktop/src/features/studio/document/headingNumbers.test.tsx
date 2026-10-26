import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import type { DocumentNode } from "@/types/studio";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { HeadingCounter } from "./headingCounter";
import { setHeadingNumbers } from "./headingNumbers";
import { createDocument, layoutOf, normalizeSettings } from "./model";
import { documentHtml } from "./toHtml";

const REPORT = "<h1>Introduction</h1><h2>Scope</h2><h3>Limits</h3><h2>Method</h2><h1>Results</h1><h3>Detail</h3>";

let editor: Editor | null = null;

function numbersOnSheet(content: string, style: "none" | "plain" | "dotted") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content });
  editor.view.dispatch(setHeadingNumbers(editor.state, style));
  return [...editor.view.dom.querySelectorAll(".vp-heading-number")].map((item) => item.textContent);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("heading numbers", () => {
  it("counts each level and restarts the levels below a new heading", () => {
    const counter = new HeadingCounter("plain");

    const labels = [1, 2, 3, 2, 1, 3].map((level) => counter.next(level));

    expect(labels).toEqual(["1", "1.1", "1.1.1", "1.2", "2", "2.0.1"]);
  });

  it("ends every number with a dot in the dotted style and leaves fifth-level headings bare", () => {
    const counter = new HeadingCounter("dotted");

    const labels = [1, 2, 5].map((level) => counter.next(level));

    expect(labels).toEqual(["1.", "1.1.", null]);
  });

  it("writes the numbers into the PDF headings so the contents and bookmarks carry them", () => {
    const content: DocumentNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scope" }] },
      ],
    };

    const { html } = documentHtml(content, { fontId: "bundled:dejavu-sans", headingFontId: null, headingNumbers: "dotted" });

    expect(html).toBe('<h1 id="h-1">1. Intro</h1><h2 id="h-2">1.1. Scope</h2>');
  });

  it("shows the same numbers on the sheet and follows the chosen style", () => {
    expect(numbersOnSheet(REPORT, "plain")).toEqual(["1 ", "1.1 ", "1.1.1 ", "1.2 ", "2 ", "2.0.1 "]);
    editor!.view.dispatch(setHeadingNumbers(editor!.state, "none"));

    expect(editor!.view.dom.querySelectorAll(".vp-heading-number")).toHaveLength(0);
  });

  it("keeps the numbers out of the saved text and the undo history", () => {
    numbersOnSheet(REPORT, "dotted");

    expect(editor!.getText()).not.toContain("1.");
    expect(editor!.can().undo()).toBe(false);
  });

  it("is off for new and older documents and never reaches the engine settings", () => {
    const settings = normalizeSettings({ headingNumbers: "roman" });

    expect(createDocument("Report").settings.headingNumbers).toBe("none");
    expect(settings.headingNumbers).toBe("none");
    expect(layoutOf(normalizeSettings({ headingNumbers: "plain" }), "Contents")).not.toHaveProperty("headingNumbers");
  });
});
