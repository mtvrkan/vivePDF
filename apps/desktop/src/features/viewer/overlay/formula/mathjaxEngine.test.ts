import { describe, expect, it } from "vitest";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import { FONT_FILES, fontFileKey, typeset } from "./mathjaxEngine";

describe("typeset", () => {
  it("turns LaTeX into a self-contained SVG with its size in em", async () => {
    const result = await typeset(String.raw`E = mc^2`);
    if ("error" in result) throw new Error(result.error);
    expect(result.svg).toMatch(/^<svg[^>]+viewBox="/);
    expect(result.svg).toContain("<path");
    expect(result.svg).not.toContain("<use");
    expect(result.svg).not.toContain("<text");
    expect(result.emWidth).toBeGreaterThan(3);
    expect(result.emHeight).toBeGreaterThan(0.5);
  });

  it("loads the extra font parts for chemistry, blackboard letters and Turkish text as paths", async () => {
    const result = await typeset(String.raw`\ce{2H2 + O2 -> 2H2O} \quad \mathbb{R} \quad \text{Hız}\ ğüşıöç`);
    if ("error" in result) throw new Error(result.error);
    expect(result.svg).not.toContain("<text");
  });

  it("reports a LaTeX mistake instead of drawing it", async () => {
    await expect(typeset(String.raw`\frac{1}{`)).resolves.toEqual({ error: expect.stringMatching(/brace/i) });
    await expect(typeset(String.raw`\nosuchcommand x`)).resolves.toEqual({ error: expect.stringMatching(/nosuchcommand/) });
  });

  it("keeps working after an error", async () => {
    await typeset(String.raw`\frac{`);
    const result = await typeset(String.raw`\sqrt{2}`);
    expect("svg" in result).toBe(true);
  });
});

describe("typeset extensions", () => {
  async function svgOf(latex: string): Promise<string> {
    const result = await typeset(latex);
    if ("error" in result) throw new Error(`${latex}: ${result.error}`);
    return result.svg;
  }

  it("knows the extra packages: cases, braket, gensymb, enclose, amscd, mathtools, units, upgreek, bussproofs", async () => {
    const samples = [
      String.raw`\begin{dcases} 1 & x > 0 \\ 0 & \text{otherwise} \end{dcases}`,
      String.raw`\braket{\psi|\phi} \quad \Set{x | x > 0}`,
      String.raw`90\degree \quad 5\celsius`,
      String.raw`\enclose{circle}{7}`,
      String.raw`\begin{CD} A @>f>> B \end{CD}`,
      String.raw`\coloneqq \quad \begin{bmatrix*}[r] -1 & 2 \end{bmatrix*}`,
      String.raw`\nicefrac{1}{2}`,
      String.raw`\upalpha`,
      String.raw`\begin{prooftree} \AxiomC{$A$} \UnaryInfC{$B$} \end{prooftree}`,
      String.raw`\newcommand{\R}{\mathbb{R}} f: \R \to \R`,
    ];
    for (const latex of samples) expect((await svgOf(latex)).startsWith("<svg")).toBe(true);
  });

  it("stops a recursive macro with an error instead of hanging", async () => {
    expect(await typeset(String.raw`\newcommand{\a}{\a} \a`)).toMatchObject({ error: expect.stringContaining("recursive") });
  });

  it("gives table rules their own width so they survive outside a web page", async () => {
    const svg = await svgOf(String.raw`\left[\begin{array}{cc|c} 1 & 2 & 3 \\ \hline 4 & 5 & 6 \end{array}\right]`);
    const rules = svg.match(/<line [^>]*data-line[^>]*>/g) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const rule of rules) expect(rule).toContain('stroke-width="70" fill="none"');
  });

  it("cuts dashed rules into pieces because the PDF renderer ignores dash patterns", async () => {
    const svg = await svgOf(String.raw`\begin{array}{c:c} a & b \\ \hdashline c & d \end{array}`);
    expect(svg).not.toContain("mjx-dashed");
    expect(svg).toMatch(/<path d="(M[-\d. ]+L[-\d. ]+){3,}" stroke-width="70"/);
  });

  it("lays numbered equations out at a fixed size without nested SVGs", async () => {
    const result = await typeset(String.raw`\begin{align} a &= b \tag{1} \\ c &= d \tag{2} \end{align}`);
    if ("error" in result) throw new Error(result.error);
    expect(result.svg).not.toContain("data-mjx-viewBox");
    expect(result.svg).not.toContain('width="100%"');
    expect((result.svg.match(/<svg\b/g) ?? []).length).toBe(1);
    expect(result.emWidth).toBeGreaterThan(3);
    expect(result.emHeight).toBeGreaterThan(1.5);
  });
});

describe("font files", () => {
  it("bundles every dynamic font part MathJax can ask for", () => {
    const dynamicFiles = (MathJaxNewcmFont as unknown as { dynamicFiles: Record<string, unknown> }).dynamicFiles;
    expect(Object.keys(dynamicFiles).sort()).toEqual(Object.keys(FONT_FILES).sort());
  });

  it("maps a requested file name to its bundled part", () => {
    expect(fontFileKey("@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js")).toBe("latin-i");
    expect(fontFileKey("somewhere/else.js")).toBeNull();
  });
});
