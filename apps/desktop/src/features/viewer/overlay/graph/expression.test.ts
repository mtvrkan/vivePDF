import { describe, expect, it } from "vitest";
import { compile, MAX_EXPRESSION_LENGTH, parseExpression, toLatex } from "./expression";

function evaluate(source: string, x: number): number {
  const result = parseExpression(source);
  if (!("expression" in result)) throw new Error(`${source}: ${result.error}`);
  return compile(result.expression)(x);
}

function latexOf(source: string): string {
  const result = parseExpression(source);
  if (!("expression" in result)) throw new Error(`${source}: ${result.error}`);
  return toLatex(result.expression);
}

describe("parseExpression", () => {
  it("follows the usual order of operations", () => {
    expect(evaluate("1 + 2 * 3", 0)).toBe(7);
    expect(evaluate("2^3^2", 0)).toBe(512);
    expect(evaluate("-x^2", 3)).toBe(-9);
    expect(evaluate("(1 + 2) * 3", 0)).toBe(9);
    expect(evaluate("8 / 4 / 2", 0)).toBe(1);
    expect(evaluate("2^-1", 0)).toBe(0.5);
  });

  it("multiplies side by side terms", () => {
    expect(evaluate("2x", 5)).toBe(10);
    expect(evaluate("3x^2", 2)).toBe(12);
    expect(evaluate("x(x+1)", 3)).toBe(12);
    expect(evaluate("(x+1)(x-1)", 3)).toBe(8);
    expect(evaluate("2pi", 0)).toBeCloseTo(2 * Math.PI);
    expect(evaluate("2|x|", -4)).toBe(8);
  });

  it("knows functions with or without brackets and constants", () => {
    expect(evaluate("sin(x)", Math.PI / 2)).toBeCloseTo(1);
    expect(evaluate("sin x", Math.PI / 2)).toBeCloseTo(1);
    expect(evaluate("sin^2 x + cos^2 x", 1.234)).toBeCloseTo(1);
    expect(evaluate("sqrt x", 16)).toBe(4);
    expect(evaluate("ln e", 0)).toBeCloseTo(1);
    expect(evaluate("log 1000", 0)).toBeCloseTo(3);
    expect(evaluate("exp(0) + abs(-2) + floor(2.7)", 0)).toBe(5);
    expect(evaluate("|x - 2|", -1)).toBe(3);
    expect(evaluate("||x| - 3|", -1)).toBe(2);
  });

  it("accepts the way people type maths", () => {
    expect(evaluate("y = x²", 3)).toBe(9);
    expect(evaluate("f(x) = x³ − 1", 2)).toBe(7);
    expect(evaluate("2×x ÷ 4", 6)).toBe(3);
    expect(evaluate("√x", 9)).toBe(3);
    expect(evaluate("π", 0)).toBeCloseTo(Math.PI);
    expect(evaluate("2,5x", 2)).toBe(5);
    expect(evaluate("x**2", 3)).toBe(9);
    expect(evaluate("[x+1]*2", 1)).toBe(4);
  });

  it("gives odd roots of negative numbers and NaN outside a function's domain", () => {
    expect(evaluate("x^(1/3)", -8)).toBeCloseTo(-2);
    expect(Number.isNaN(evaluate("x^0.5", -4))).toBe(true);
    expect(Number.isNaN(evaluate("ln x", -1))).toBe(true);
    expect(evaluate("1/x", 0)).toBe(Infinity);
  });

  it("reports what is wrong and where", () => {
    expect(parseExpression("")).toMatchObject({ error: "empty" });
    expect(parseExpression("y = ")).toMatchObject({ error: "empty" });
    expect(parseExpression("x +")).toMatchObject({ error: "unexpected", detail: "" });
    expect(parseExpression("x + * 2")).toMatchObject({ error: "unexpected", detail: "*" });
    expect(parseExpression("(x + 1")).toMatchObject({ error: "unclosed", detail: "(", position: 0 });
    expect(parseExpression("|x")).toMatchObject({ error: "unclosed", detail: "|" });
    expect(parseExpression("x + 1)")).toMatchObject({ error: "unexpected", detail: ")" });
    expect(parseExpression("2 * foo")).toMatchObject({ error: "unknownName", detail: "foo", position: 4 });
    expect(parseExpression("x # 2")).toMatchObject({ error: "unexpected", detail: "#" });
    expect(parseExpression("x".repeat(MAX_EXPRESSION_LENGTH + 1))).toMatchObject({ error: "tooLong" });
    expect(parseExpression(`${"(".repeat(60)}x${")".repeat(60)}`)).toMatchObject({ error: "tooDeep" });
    expect(parseExpression("-".repeat(80) + "x")).toMatchObject({ error: "tooDeep" });
  });

  it("never runs what it reads as code", () => {
    expect(parseExpression("constructor")).toMatchObject({ error: "unknownName" });
    expect(parseExpression("alert(1)")).toMatchObject({ error: "unknownName" });
    expect(parseExpression("x; x")).toMatchObject({ error: "unexpected", detail: ";" });
  });
});

describe("toLatex", () => {
  it("writes typeset maths for the legend", () => {
    expect(latexOf("x^2 - 2")).toBe("x^{2} - 2");
    expect(latexOf("1/x")).toBe("\\frac{1}{x}");
    expect(latexOf("sqrt(x+1)")).toBe("\\sqrt{x + 1}");
    expect(latexOf("|x|")).toBe("\\left|x\\right|");
    expect(latexOf("2x")).toBe("2 x");
    expect(latexOf("x*2")).toBe("x \\cdot 2");
    expect(latexOf("pi x")).toBe("\\pi x");
    expect(latexOf("sin x")).toBe("\\sin x");
    expect(latexOf("sin(2x)")).toBe("\\sin\\left(2 x\\right)");
    expect(latexOf("(x+1)^2")).toBe("\\left(x + 1\\right)^{2}");
    expect(latexOf("x - (x - 1)")).toBe("x - \\left(x - 1\\right)");
    expect(latexOf("-(x+1)")).toBe("-\\left(x + 1\\right)");
    expect(latexOf("e^x")).toBe("e^{x}");
    expect(latexOf("exp(x)")).toBe("e^{x}");
  });
});
