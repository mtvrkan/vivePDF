import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { WatchRule } from "@/shared/store/watchStore";
import { catchUpExcludes, insideFolder, sortingFolders, watchSignature } from "./watchFolders";

const t = ((key: string) => (key.endsWith("processedDefault") ? "Processed" : "Failed")) as unknown as TFunction;
const rule = (patch: Partial<WatchRule> = {}): WatchRule => ({ id: "a", folder: "C:/in", chainId: "c", outputDir: "C:/out", recursive: false, enabled: true, ...patch });

describe("sortingFolders", () => {
  it("places the stored folder names inside the watched folder", () => {
    expect(sortingFolders(rule({ moveSources: true, processedName: "Done", failedName: "Bad" }), t)).toEqual({ processed: "C:/in/Done", failed: "C:/in/Bad" });
  });

  it("falls back to the translated names when a rule has none", () => {
    expect(sortingFolders(rule({ moveSources: true }), t)).toEqual({ processed: "C:/in/Processed", failed: "C:/in/Failed" });
  });

  it("returns nothing when the rule leaves sources in place", () => {
    expect(sortingFolders(rule(), t)).toBeNull();
  });
});

describe("insideFolder", () => {
  it("matches files below the folder regardless of case and separators", () => {
    expect(insideFolder("C:\\In\\Done\\scan.pdf", "C:/in/done")).toBe(true);
    expect(insideFolder("C:/in/Done2/scan.pdf", "C:/in/Done")).toBe(false);
    expect(insideFolder("C:/in/scan.pdf", "")).toBe(false);
  });
});

describe("catchUpExcludes and watchSignature", () => {
  it("leaves out the output and sorting folders", () => {
    expect(catchUpExcludes(rule(), { processed: "C:/in/Done", failed: "C:/in/Bad" })).toEqual(["C:/out", "C:/in/Done", "C:/in/Bad"]);
    expect(catchUpExcludes(rule({ outputDir: "" }), null)).toEqual([]);
  });

  it("changes only when the watcher itself has to change", () => {
    expect(watchSignature(rule({ catchUp: true }))).toBe(watchSignature(rule()));
    expect(watchSignature(rule({ recursive: true }))).not.toBe(watchSignature(rule()));
    expect(watchSignature(rule({ outputDir: "C:/other" }))).not.toBe(watchSignature(rule()));
    expect(watchSignature(rule({ chainId: "another-chain" }))).not.toBe(watchSignature(rule()));
  });
});
