import { describe, expect, it } from "vitest";
import { box, design, FONTS, pageOf, solid, text } from "./kit";
import { inkBox, qualityIssues } from "./quality";

const kinds = (built: ReturnType<typeof design>) => qualityIssues(built).map((issue) => issue.kind);

describe("template quality gate", () => {
  it("passes dark text on a light page and light text on a dark card", () => {
    const built = design("Good", [], [pageOf("a4", solid("#fbf8f1"), [text(40, 40, 300, 30, "Readable", { color: "#111827" }), box("rect", 40, 120, 300, 80, solid("#0f172a")), text(60, 140, 260, 30, "On the card", { color: "#ffffff" })])]);

    expect(kinds(built)).toEqual([]);
  });

  it("flags pale body text but lets the same colour pass at display size", () => {
    const pale = design("Pale", [], [pageOf("a4", solid("#ffffff"), [text(40, 40, 300, 30, "Too light", { color: "#9ca3af", size: 12 })])]);
    const large = design("Large", [], [pageOf("a4", solid("#ffffff"), [text(40, 40, 400, 60, "Big title", { color: "#8b8b8b", size: 36 })])]);

    expect(kinds(pale)).toEqual(["contrast"]);
    expect(kinds(large)).toEqual([]);
  });

  it("sees a see-through shape under the text and skips text over pictures", () => {
    const tinted = design("Tint", [], [pageOf("a4", solid("#ffffff"), [box("rect", 0, 0, 400, 200, solid("#000000"), { opacity: 0.9 }), text(40, 40, 300, 30, "Dark on dark", { color: "#1f2937" })])]);

    expect(kinds(tinted)).toEqual(["contrast"]);
  });

  it("only reports text that actually collides, ignoring decorative marks", () => {
    const row = design("Row", [], [pageOf("a4", solid("#ffffff"), [text(40, 40, 400, 20, "Product", { color: "#111827" }), text(40, 40, 400, 20, "$12.00", { color: "#111827", align: "right" }), text(40, 30, 60, 60, "“", { color: "#111827", size: 48 })])]);
    const clash = design("Clash", [], [pageOf("a4", solid("#ffffff"), [text(40, 40, 300, 30, "Heading", { color: "#111827", size: 20 }), text(50, 45, 300, 30, "Subtitle", { color: "#111827", size: 20 })])]);

    expect(kinds(row)).toEqual([]);
    expect(kinds(clash)).toEqual(["overlap"]);
  });

  it("allows three font families and flags a fourth", () => {
    const fonts = [FONTS.inter, FONTS.playfair, FONTS.greatVibes, FONTS.oswald];
    const elements = (count: number) => fonts.slice(0, count).map((font, index) => text(40, 40 + index * 60, 300, 30, `Line ${index}`, { font, color: "#111827" }));

    expect(kinds(design("Three", [], [pageOf("a4", solid("#ffffff"), elements(3))]))).toEqual([]);
    expect(kinds(design("Four", [], [pageOf("a4", solid("#ffffff"), elements(4))]))).toEqual(["fonts"]);
  });

  it("estimates the inked area from alignment and length", () => {
    const right = inkBox(text(0, 0, 400, 20, "abcd", { size: 10, align: "right" }));

    expect(right.x + right.width).toBeCloseTo(400);
    expect(right.width).toBeLessThan(40);
  });
});
