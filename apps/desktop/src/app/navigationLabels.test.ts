import { describe, expect, it } from "vitest";
import { primaryNavigation, secondaryNavigation, toolNavigation, toolShortcuts } from "./navigation";

const catalogs = import.meta.glob<Record<string, unknown>>("../locales/*/common.json", { eager: true, import: "default" });

function lookup(catalog: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
}

function missing(keys: string[]) {
  return Object.entries(catalogs).flatMap(([file, catalog]) =>
    keys.filter((key) => typeof lookup(catalog, key) !== "string").map((key) => `${file.split("/")[2]}: ${key}`),
  );
}

describe("navigation labels", () => {
  it("reads all eight language catalogues", () => {
    expect(Object.keys(catalogs)).toHaveLength(8);
  });

  it("names and describes every tool card in every language", () => {
    expect(missing(toolShortcuts.flatMap((tool) => [tool.labelKey, tool.descriptionKey]))).toEqual([]);
  });

  it("names every navigation entry in every language", () => {
    expect(missing([...primaryNavigation, ...toolNavigation, ...secondaryNavigation].map((item) => item.labelKey))).toEqual([]);
  });
});
