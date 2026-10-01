import { describe, expect, it } from "vitest";
import { drawMolecule } from "./moleculeEngine";
import { DEFAULT_MOLECULE_LOOK } from "./moleculeModel";
import { clipSegment, clipWedge, dashSegment, LABEL_FONT_SIZE, layoutLabel, scriptRuns, textAdvance } from "./moleculeSvg";

function art(smiles: string, look = DEFAULT_MOLECULE_LOOK) {
  const result = drawMolecule(smiles, look);
  if (!("svg" in result)) throw new Error(`not drawn: ${result.error}`);
  return { ...result, doc: new DOMParser().parseFromString(result.svg, "image/svg+xml") };
}

function texts(doc: Document): string[] {
  return [...doc.querySelectorAll("text")].map((node) => node.textContent ?? "");
}

describe("molecule drawing", () => {
  it("draws aspirin as plain lines, polygons and real text the PDF engine understands", () => {
    const { svg, doc, width, height } = art("CC(=O)Oc1ccccc1C(=O)O");
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(svg).not.toMatch(/url\(|<mask|<style|clip-path|transform|text-anchor|stroke-dasharray/);
    expect(texts(doc).join("")).toContain("O");
    expect(doc.querySelectorAll("line").length).toBeGreaterThan(10);
    for (const node of doc.querySelectorAll("text")) {
      expect(node.getAttribute("font-family")).toContain("Helvetica");
      expect(Number(node.getAttribute("x"))).toBeGreaterThanOrEqual(0);
    }
  });

  it("paints bonds in the chosen colour and only colours atoms when asked", () => {
    const coloured = art("CCO", { ...DEFAULT_MOLECULE_LOOK, color: "#123456" });
    expect(coloured.doc.querySelector("g")?.getAttribute("stroke")).toBe("#123456");
    expect([...coloured.doc.querySelectorAll("text")].some((node) => node.getAttribute("fill") !== "#123456")).toBe(true);
    const plain = art("CCO", { ...DEFAULT_MOLECULE_LOOK, color: "#123456", colorAtoms: false });
    expect([...plain.doc.querySelectorAll("text")].every((node) => node.getAttribute("fill") === "#123456")).toBe(true);
  });

  it("writes charges, isotopes and hydrogen counts as raised and lowered digits", () => {
    const { doc } = art("[NH4+].[13CH4].[Fe+3]");
    const all = texts(doc);
    expect(all).toEqual(expect.arrayContaining(["N", "+", "H", "4", "13", "C", "Fe", "3+"]));
    expect(all.join("")).not.toMatch(/[⁰-⁹₀-₉⁺⁻]/);
    const sizes = new Map([...doc.querySelectorAll("text")].map((node) => [node.textContent, Number(node.getAttribute("font-size"))]));
    expect(sizes.get("13")).toBeLessThan(sizes.get("C") ?? 0);
  });

  it("labels end carbons only when asked", () => {
    expect(texts(art("CCCO").doc)).not.toContain("C");
    expect(texts(art("CCCO", { ...DEFAULT_MOLECULE_LOOK, terminalCarbons: true }).doc)).toContain("C");
  });

  it("tells an empty and a broken SMILES apart", () => {
    expect(drawMolecule("  \n ", DEFAULT_MOLECULE_LOOK)).toEqual({ error: "empty", position: null });
    expect(drawMolecule("C1CC(", DEFAULT_MOLECULE_LOOK)).toMatchObject({ error: "invalid" });
    expect(drawMolecule("CC)Q", DEFAULT_MOLECULE_LOOK)).toMatchObject({ error: "invalid" });
  });
});

describe("molecule geometry", () => {
  const circle = { x: 10, y: 0, r: 2 };

  it("stops a bond at the edge of an atom label", () => {
    const [piece] = clipSegment({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, width: 1 }, [circle]);
    expect(piece.a).toEqual({ x: 0, y: 0 });
    expect(piece.b.x).toBeCloseTo(8);
    expect(clipSegment({ a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, width: 1 }, [circle])).toHaveLength(1);
    expect(clipSegment({ a: { x: 9, y: 0 }, b: { x: 11, y: 0 }, width: 1 }, [circle])).toEqual([]);
  });

  it("cuts a wedge where it enters a label and splits dashed bonds into dashes", () => {
    const wedge = clipWedge([{ x: 0, y: 0 }, { x: 10, y: -2 }, { x: 10, y: 2 }], [circle]);
    expect(Math.max(...wedge.map((point) => point.x))).toBeCloseTo(8);
    expect(dashSegment({ a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, width: 1 }, [5, 5])).toHaveLength(2);
  });

  it("centres the element symbol on its atom, whichever side the hydrogens go", () => {
    const right = layoutLabel({ x: 50, y: 0, direction: "right", parts: [{ text: "N", color: "#000000" }, { text: "H₂", color: "#000000" }] });
    expect(right[0].x + textAdvance("N", LABEL_FONT_SIZE) / 2).toBeCloseTo(50);
    const left = layoutLabel({ x: 50, y: 0, direction: "left", parts: [{ text: "H", color: "#000000" }, { text: "O", color: "#000000" }] });
    const oxygen = left.find((glyph) => glyph.text === "O");
    expect((oxygen?.x ?? 0) + textAdvance("O", LABEL_FONT_SIZE) / 2).toBeCloseTo(50);
    expect(left.find((glyph) => glyph.text === "H")?.x).toBeLessThan(oxygen?.x ?? 0);
    expect(scriptRuns("¹³C⁻")).toEqual([
      { text: "13", script: "sup" },
      { text: "C", script: "base" },
      { text: "−", script: "sup" },
    ]);
  });
});
