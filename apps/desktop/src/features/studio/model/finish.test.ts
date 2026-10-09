import { describe, expect, it } from "vitest";
import { createDesign, createText, normalizeDesign } from "./design";
import { defaultFinish, finishReach, finishRecipe, normalizeFinish } from "./finish";

const box = { rotation: 0, width: 100, height: 40 };

describe("print finishes", () => {
  it("lights an emboss from the top left and leaves the ink out when blind", () => {
    const recipe = finishRecipe(defaultFinish("emboss"), box);

    expect(recipe.dx).toBeCloseTo(1.2 * Math.SQRT1_2);
    expect(recipe.dy).toBeCloseTo(1.2 * Math.SQRT1_2);
    expect(recipe.ink).toBe(false);
    expect(recipe.layers.find((layer) => layer.region === "light")?.color).toBe("#ffffff");
    expect(recipe.texture).toBeNull();
  });

  it("swaps the lit and shaded edges for a deboss and keeps the ink when not blind", () => {
    const recipe = finishRecipe({ ...defaultFinish("deboss"), blind: false }, box);

    expect(recipe.ink).toBe(true);
    expect(recipe.layers.find((layer) => layer.region === "light")?.color).toBe("#000000");
    expect(recipe.layers.find((layer) => layer.region === "away")?.color).toBe("#ffffff");
  });

  it("turns the light with the element so the page light stays put", () => {
    const upright = finishRecipe(defaultFinish("emboss"), box);
    const turned = finishRecipe(defaultFinish("emboss"), { ...box, rotation: 90 });
    const mirrored = finishRecipe(defaultFinish("emboss"), { ...box, flipX: true });

    expect(turned.dx).toBeCloseTo(upright.dy);
    expect(turned.dy).toBeCloseTo(-upright.dx);
    expect(mirrored.dx).toBeCloseTo(-upright.dx);
    expect(mirrored.dy).toBeCloseTo(upright.dy);
  });

  it("replaces the ink with metal for foil and glazes over it for spot UV", () => {
    const foil = finishRecipe(defaultFinish("foil", "silver"), box);
    const gloss = finishRecipe(defaultFinish("spotUv"), box);

    expect(foil.ink).toBe(false);
    expect(foil.texture?.replace).toBe(true);
    expect(foil.texture?.stops[1].color).toBe("#f4f6f8");
    expect(gloss.ink).toBe(true);
    expect(gloss.texture?.replace).toBe(false);
    expect(finishReach(gloss)).toBeGreaterThan(2);
  });

  it("clamps stored values and drops unknown finishes", () => {
    expect(normalizeFinish({ type: "emboss", depth: 99, softness: -1, angle: -45, blind: "yes", foil: "brass" })).toEqual({ type: "emboss", depth: 3, softness: 0, angle: 315, blind: true, foil: "gold" });
    expect(normalizeFinish({ type: "glitter" })).toBeNull();
    expect(normalizeFinish("emboss")).toBeNull();
  });

  it("keeps a finish through a save and leaves plain elements without one", () => {
    const design = createDesign("", 240, 155);
    const plain = createText(10, 10, 100, 30, "Plain");
    const pressed = { ...createText(10, 50, 100, 30, "Pressed"), finish: defaultFinish("letterpress") };
    const saved = { ...design, pages: [{ ...design.pages[0], elements: [plain, pressed] }] };

    const elements = normalizeDesign(JSON.parse(JSON.stringify(saved)))?.pages[0].elements ?? [];

    expect(elements[0]).not.toHaveProperty("finish");
    expect(elements[1].finish).toEqual(defaultFinish("letterpress"));
  });
});
