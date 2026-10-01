import { describe, expect, it } from "vitest";
import { DRAWING_SPECS } from "@/features/viewer/overlay/drawing/drawingKinds";
import { DRAWING_KINDS } from "@/features/viewer/overlay/drawing/drawingSource";
import { CHART_TYPES } from "@/features/viewer/overlay/chart/chartModel";
import ar from "./ar/common.json";
import de from "./de/common.json";
import en from "./en/common.json";
import es from "./es/common.json";
import fr from "./fr/common.json";
import it_ from "./it/common.json";
import ja from "./ja/common.json";
import ko from "./ko/common.json";
import ptBR from "./pt-BR/common.json";
import ru from "./ru/common.json";
import tr from "./tr/common.json";
import zhCN from "./zh-CN/common.json";

const catalogs: Record<string, unknown> = { ar, de, en, es, fr, it: it_, ja, ko, "pt-BR": ptBR, ru, tr, "zh-CN": zhCN };

function lookup(catalog: unknown, key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
  return typeof value === "string" ? value : "";
}

function duplicates(labels: string[]): string[] {
  return [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
}

const SIBLING_GROUPS: Record<string, string[]> = {
  drawingPicks: DRAWING_KINDS.map((kind) => DRAWING_SPECS[kind].labels.pick),
  drawingMenus: DRAWING_KINDS.map((kind) => DRAWING_SPECS[kind].labels.menu),
  chartTypes: CHART_TYPES.map((type) => `viewer.chart.types.${type}`),
};

describe("labels shown side by side", () => {
  it.each(Object.keys(catalogs))("are distinct in %s", (locale) => {
    const clashes = Object.fromEntries(
      Object.entries(SIBLING_GROUPS)
        .map(([group, keys]) => [group, duplicates(keys.map((key) => lookup(catalogs[locale], key)))] as const)
        .filter(([, found]) => found.length > 0),
    );
    expect(clashes).toEqual({});
  });

  it("finds every key it compares", () => {
    const missing = Object.values(SIBLING_GROUPS)
      .flat()
      .filter((key) => lookup(en, key) === "");
    expect(missing).toEqual([]);
  });

  it("reports a clash when two buttons share a label", () => {
    expect(duplicates(["Grafik", "Tablo", "Grafik"])).toEqual(["Grafik"]);
  });
});
