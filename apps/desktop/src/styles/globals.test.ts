import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("globals.css", () => {
  it("leaves the -webkit- backdrop prefix to the CSS minifier", () => {
    expect(css).not.toMatch(/-webkit-backdrop-filter\s*:/);
  });

  it("keeps the blur on the glass surfaces", () => {
    for (const selector of [".glass-flat", ".glass-chip", ".glass-menu", ".glass"]) {
      const block = css.slice(css.indexOf(`  ${selector} {`));
      expect(block.slice(0, block.indexOf("}")), selector).toMatch(/backdrop-filter:\s*blur\(/);
    }
  });

  it("paints menus and toolbars that float over pages fully opaque", () => {
    const block = css.slice(css.indexOf("  .glass-menu {"));
    expect(block.slice(0, block.indexOf("}"))).toMatch(/background:\s*var\(--color-card\);/);
  });
});
