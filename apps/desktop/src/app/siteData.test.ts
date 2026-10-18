import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, splitKeys } from "@/features/about/shortcutGroups";
import { RELEASE_NOTES, releaseKey } from "@/features/about/releaseNotes";
import { FULLSCREEN_KEYS, shortcutLabel } from "@/shared/lib/platform";
import en from "@/locales/en/common.json";
import tr from "@/locales/tr/common.json";
import packageJson from "../../package.json";
import { toolGroups, toolShortcuts } from "./navigation";

const SITE_DATA = new URL("../../../site/src/data/app-data.json", import.meta.url);
const catalogs = { tr, en } as const;
type SiteLocale = keyof typeof catalogs;
type Localized = Record<SiteLocale, string>;

function lookup(catalog: unknown, key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalog);
  if (typeof value !== "string") throw new Error(`Missing site label: ${key}`);
  return value;
}

function localized(key: string): Localized {
  return { tr: lookup(catalogs.tr, key), en: lookup(catalogs.en, key) };
}

function macKeys(keys: string): string {
  return keys === FULLSCREEN_KEYS.other ? FULLSCREEN_KEYS.mac : shortcutLabel(keys, true);
}

function buildSiteData() {
  return {
    version: packageJson.version,
    tools: {
      groups: toolGroups.map((id) => ({ id, label: localized(`tools.grid.groups.${id}`) })),
      items: toolShortcuts.map((tool) => ({
        id: tool.id,
        group: tool.group,
        label: localized(tool.labelKey),
        description: localized(tool.descriptionKey),
      })),
    },
    shortcuts: {
      gestures: { tr: catalogs.tr.tools.pages.gesture, en: catalogs.en.tools.pages.gesture },
      groups: SHORTCUT_GROUPS.map((group) => ({
        id: group.id,
        label: localized(`about.shortcuts.groups.${group.id}`),
        items: group.items.map((item) => ({
          label: localized(item.labelKey),
          win: splitKeys(item.keys),
          mac: splitKeys(macKeys(item.keys)),
        })),
      })),
    },
    releases: RELEASE_NOTES.map((note) => ({
      version: note.version,
      items: note.items.map((id) => localized(`whatsNew.releases.${releaseKey(note.version)}.${id}`)),
    })),
  };
}

describe("site data", () => {
  it("keeps apps/site/src/data/app-data.json in step with the app", () => {
    const expected = `${JSON.stringify(buildSiteData(), null, 2)}\n`;
    if (process.env.UPDATE_SITE_DATA === "1") writeFileSync(SITE_DATA, expected);
    let current = "";
    try {
      current = readFileSync(SITE_DATA, "utf8");
    } catch {
      current = "";
    }
    expect(current, "Run UPDATE_SITE_DATA=1 pnpm vitest run src/app/siteData.test.ts in apps/desktop").toBe(expected);
  });

  it("counts every tool once", () => {
    const ids = buildSiteData().tools.items.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a label that is missing from a catalogue", () => {
    expect(() => localized("tools.grid.descriptions.notATool")).toThrow("Missing site label");
  });
});
