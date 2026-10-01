import { describe, expect, it } from "vitest";
import en from "@/locales/en/common.json";
import tr from "@/locales/tr/common.json";
import { clampParams, initialParams, isRotatable, SHAPE_GROUPS, SHAPES, shapeById } from "./catalog";
import { isFinitePrimitive } from "./primitives";
import { DEFAULT_SHAPE_STYLE, renderShape } from "./render";

describe("shape catalog", () => {
  it("gives every shape a unique id, a known group and a name in each language", () => {
    const ids = SHAPES.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shape of SHAPES) {
      expect(SHAPE_GROUPS).toContain(shape.group);
      expect(en.viewer.shapes.names).toHaveProperty(shape.id);
      expect(tr.viewer.shapes.names).toHaveProperty(shape.id);
      for (const param of shape.params) {
        expect(en.viewer.shapes.params).toHaveProperty(param.key);
        expect(tr.viewer.shapes.params).toHaveProperty(param.key);
      }
    }
  });

  it("draws every shape at its starting values and at both ends of each slider", () => {
    for (const shape of SHAPES) {
      const variants = [initialParams(shape)];
      for (const param of shape.params) {
        if (param.kind === "range") {
          variants.push({ ...initialParams(shape), [param.key]: param.min });
          variants.push({ ...initialParams(shape), [param.key]: param.max });
        } else {
          variants.push({ ...initialParams(shape), [param.key]: !param.initial });
        }
      }
      for (const params of variants) {
        const primitives = shape.build(params);
        expect(primitives.length, shape.id).toBeGreaterThan(0);
        expect(primitives.every(isFinitePrimitive), `${shape.id} ${JSON.stringify(params)}`).toBe(true);
        const rendered = renderShape(primitives, DEFAULT_SHAPE_STYLE, new Map());
        expect(rendered.width, shape.id).toBeGreaterThan(10);
        expect(rendered.height, shape.id).toBeGreaterThan(10);
        expect(rendered.svg).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("keeps slider values inside their range and replaces junk with the starting value", () => {
    const polygon = shapeById("polygon");
    if (!polygon) throw new Error("missing polygon");
    expect(clampParams(polygon, { sides: 40, radius: -5 })).toEqual({ sides: 12, radius: 30 });
    expect(clampParams(polygon, { sides: Number.NaN, radius: "big" as unknown as number })).toEqual({ sides: 6, radius: 70 });
    const axes = shapeById("axes");
    if (!axes) throw new Error("missing axes");
    expect(clampParams(axes, { grid: 1 as unknown as boolean, extra: 5 })).toEqual({ range: 5, grid: false });
  });

  it("lets only the solids be turned", () => {
    for (const shape of SHAPES) expect(isRotatable(shape), shape.id).toBe(shape.group === "solids");
    expect(shapeById("nope")).toBeNull();
  });
});
