import { afterEach, describe, expect, it } from "vitest";
import { createDesign, createImage, createQr, createShape, createText } from "../model/design";
import { applyStyle, extractStyle } from "./elementStyle";
import { copyStyle, pasteStyle, useStyleClipboard } from "./styleClipboard";
import { useStudioStore } from "./studioStore";

const dashed = { color: "#ff0000", width: 3, dash: "dashed" as const, cap: "round" as const };

describe("copy and paste style", () => {
  afterEach(() => {
    useStudioStore.getState().close();
    useStyleClipboard.setState({ style: null });
  });

  it("copies the look of a shape but not its place, size or outline", () => {
    const source = createShape("star", 0, 0, 50, 50, { fill: { type: "solid", color: "#123456" }, stroke: dashed, cornerRadius: 6, opacity: 0.5, points: 7 });
    const target = createShape("rect", 100, 100, 20, 30);
    const styled = applyStyle(target, extractStyle(source));

    expect(styled).toMatchObject({ x: 100, y: 100, width: 20, height: 30, shape: "rect", points: target.points, fill: { type: "solid", color: "#123456" }, stroke: dashed, cornerRadius: 6, opacity: 0.5 });
    expect(styled.kind === "shape" && styled.stroke).not.toBe(source.stroke);
  });

  it("passes only what the other kind understands", () => {
    const shape = createShape("rect", 0, 0, 10, 10, { stroke: dashed, cornerRadius: 4, opacity: 0.7 });
    const photo = applyStyle(createImage("a.png", 0, 0, 10, 10), extractStyle(shape));
    const text = createText(0, 0, 10, 10, "Hi");

    expect(photo).toMatchObject({ src: "a.png", stroke: dashed, cornerRadius: 4, opacity: 0.7 });
    expect(applyStyle(text, extractStyle(shape))).toMatchObject({ opacity: 0.7, color: text.color });
    expect(applyStyle(createQr("x", 0, 0, 10), extractStyle(createText(0, 0, 1, 1, "", { color: "#00aa00" })))).toMatchObject({ value: "x", color: "#00aa00" });
  });

  it("gives text the whole text style and clears styled words", () => {
    const source = createText(0, 0, 10, 10, "Title", { fontId: "library:lora", fontSize: 40, color: "#333333", bold: true, align: "center", letterSpacing: 0.1 });
    const target = createText(0, 0, 10, 10, "", { runs: [{ text: "Hello " }, { text: "world", italic: true, color: "#ff0000" }] });
    const styled = applyStyle(target, extractStyle(source));

    expect(styled).toMatchObject({ fontId: "library:lora", fontSize: 40, color: "#333333", bold: true, italic: false, align: "center", letterSpacing: 0.1, runs: [{ text: "Hello world" }] });
    expect(applyStyle(source, extractStyle(source))).toBe(source);
  });

  it("pastes onto the whole selection in one undo step and skips locked elements", () => {
    const design = createDesign("Style", 200, 200);
    const source = createShape("rect", 0, 0, 10, 10, { fill: { type: "solid", color: "#abcdef" } });
    const first = createShape("ellipse", 20, 0, 10, 10);
    const locked = { ...createShape("ellipse", 40, 0, 10, 10), locked: true };
    const store = useStudioStore.getState();
    store.open({ ...design, pages: [{ ...design.pages[0], elements: [source, first, locked] }] });

    store.select([source.id]);
    copyStyle();
    useStudioStore.getState().select([first.id, locked.id]);
    pasteStyle();

    const elements = useStudioStore.getState().design?.pages[0].elements ?? [];
    expect(elements[1]).toMatchObject({ fill: { type: "solid", color: "#abcdef" } });
    expect(elements[2]).toBe(locked);
    expect(useStudioStore.getState().past).toHaveLength(1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().design?.pages[0].elements[1]).toEqual(first);
  });

  it("does nothing without a copied style or a selection", () => {
    const design = createDesign("Style", 200, 200);
    useStudioStore.getState().open(design);

    pasteStyle();
    copyStyle();

    expect(useStyleClipboard.getState().style).toBeNull();
    expect(useStudioStore.getState().past).toHaveLength(0);
  });
});
