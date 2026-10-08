import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/locales/en/common.json";
import type { StudioElement, StudioPage } from "@/types/studio";
import { BUILTIN_PLACEHOLDERS, normalizeDesign, placeholdersIn } from "../model/design";
import { buildTemplate, STUDIO_TEMPLATES, TEMPLATE_CATEGORIES } from "./catalog";
import { insertTemplate } from "./apply";
import { sizeOf } from "./kit";
import { qualityIssues } from "./quality";

function lookup(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), en);
  if (typeof value !== "string") throw new Error(`missing English string ${key}`);
  return value;
}

const REDESIGNED = new Set<string>(["certificates", "flyers", "cards"]);

const designs = STUDIO_TEMPLATES.map((template) => ({ template, design: buildTemplate(template, lookup, "en") }));
const libraryCatalog = readFileSync(new URL("../../../../../../sidecar/vivepdf/ops/font_library_catalog.py", import.meta.url), "utf8");

function fontIds(element: StudioElement): string[] {
  return element.kind === "text" && element.fontId ? [element.fontId] : [];
}

function outside(element: StudioElement, page: StudioPage): boolean {
  return element.x >= page.width || element.y >= page.height || element.x + element.width <= 0 || element.y + element.height <= 0;
}

describe("studio templates", () => {
  it("ships about sixty templates with unique ids in every category", () => {
    expect(STUDIO_TEMPLATES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(STUDIO_TEMPLATES.map((template) => template.id)).size).toBe(STUDIO_TEMPLATES.length);
    for (const category of TEMPLATE_CATEGORIES) expect(STUDIO_TEMPLATES.some((template) => template.category === category), category).toBe(true);
  });

  it("builds valid designs that survive normalisation unchanged", () => {
    for (const { template, design } of designs) {
      expect(design.pages.length, template.id).toBeGreaterThan(0);
      expect(normalizeDesign(JSON.parse(JSON.stringify(design))), template.id).toEqual(design);
    }
  });

  it("uses the declared page size and keeps every element on the page", () => {
    for (const { template, design } of designs) {
      const size = sizeOf(template.size);
      for (const page of design.pages) {
        expect([page.width, page.height], template.id).toEqual([size.width, size.height]);
        for (const element of page.elements) {
          expect(outside(element, page), `${template.id} ${element.kind} ${element.x},${element.y}`).toBe(false);
          if (element.kind === "text") {
            expect(element.x >= -0.5 && element.y >= -0.5 && element.x + element.width <= page.width + 0.5 && element.y + element.height <= page.height + 0.5, `${template.id} text "${element.runs.map((run) => run.text).join("")}"`).toBe(true);
          }
        }
      }
    }
  });

  it("only uses fonts from the download library", () => {
    for (const { template, design } of designs) {
      for (const element of design.pages.flatMap((page) => page.elements)) {
        for (const id of fontIds(element)) {
          expect(id.startsWith("library:"), `${template.id} ${id}`).toBe(true);
          expect(libraryCatalog.includes(`"${id.slice("library:".length)}",`), `${template.id} ${id}`).toBe(true);
        }
      }
    }
  });

  it("only uses the built-in serial number and date placeholders", () => {
    for (const { template, design } of designs) {
      for (const name of placeholdersIn(design)) expect(BUILTIN_PLACEHOLDERS as readonly string[], `${template.id} {${name}}`).toContain(name);
    }
  });

  it("keeps text readable, apart from other text and in at most three font families", () => {
    const problems = designs.filter(({ template }) => REDESIGNED.has(template.category)).flatMap(({ template, design }) => qualityIssues(design).map((issue) => `${template.id} p${issue.page + 1} ${issue.kind}: ${issue.detail}`));

    expect(problems).toEqual([]);
  });

  it("gives every element a fresh id each time a template is built", () => {
    const first = buildTemplate(STUDIO_TEMPLATES[0], lookup, "en");
    const second = buildTemplate(STUDIO_TEMPLATES[0], lookup, "en");
    const ids = (design: typeof first) => design.pages.flatMap((page) => [page.id, ...page.elements.map((element) => element.id)]);
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
  });
});

describe("inserting a template into a design", () => {
  const base = designs[0].design;
  const template = designs[1].design;

  it("replaces an empty current page and opens the first template page", () => {
    const empty = { ...base, name: "", pages: [{ ...base.pages[0], elements: [] }] };
    const result = insertTemplate(empty, empty.pages[0].id, template);
    expect(result?.design.pages.map((page) => page.id)).toEqual(template.pages.map((page) => page.id));
    expect(result?.pageId).toBe(template.pages[0].id);
    expect(result?.design.name).toBe(template.name);
  });

  it("adds the pages after a page that already has content and keeps the name", () => {
    const result = insertTemplate(base, base.pages[0].id, template);
    expect(result?.design.pages.map((page) => page.id)).toEqual([base.pages[0].id, ...template.pages.map((page) => page.id)]);
    expect(result?.design.name).toBe(base.name);
    expect(new Set(result?.design.palette).size).toBe(result?.design.palette.length);
  });

  it("refuses when the design would pass the page limit", () => {
    const crowded = { ...base, pages: Array.from({ length: 500 }, (_, index) => ({ ...base.pages[0], id: `p${index}` })) };
    expect(insertTemplate(crowded, "p0", template)).toBeNull();
  });
});
