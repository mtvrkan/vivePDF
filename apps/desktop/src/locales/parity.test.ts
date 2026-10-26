import { describe, expect, it } from "vitest";
import ar from "./ar/common.json";
import de from "./de/common.json";
import en from "./en/common.json";
import es from "./es/common.json";
import fr from "./fr/common.json";
import it_ from "./it/common.json";
import ptBR from "./pt-BR/common.json";
import tr from "./tr/common.json";

type Catalog = Record<string, unknown>;

const catalogs: Record<string, Catalog> = { ar, de, es, fr, it: it_, "pt-BR": ptBR, tr };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keys(node: Catalog, prefix = "", out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") keys(value as Catalog, path, out);
    else out.add(path.replace(PLURAL_SUFFIX, ""));
  }
  return out;
}

const english = keys(en as Catalog);

describe("locale key parity", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has every English key and no key English lacks`, () => {
      const own = keys(catalog);

      const missing = [...english].filter((key) => !own.has(key));
      const extra = [...own].filter((key) => !english.has(key));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }
});
