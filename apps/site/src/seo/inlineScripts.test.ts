import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INLINE_SCRIPTS, inlineScriptHashes } from "./inlineScripts";

describe("inline script hashes", () => {
  it("gives one sha256 source per inline script", () => {
    const hashes = inlineScriptHashes();

    expect(hashes).toHaveLength(Object.keys(INLINE_SCRIPTS).length);
    expect(new Set(hashes).size).toBe(hashes.length);
    hashes.forEach((h) => expect(h).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/));
  });

  it("hashes the exact script text the page carries", () => {
    const expected = createHash("sha256").update(INLINE_SCRIPTS.theme).digest("base64");

    expect(inlineScriptHashes()[0]).toBe(`sha256-${expected}`);
  });

  it("keeps the 404 swap limited to English addresses", () => {
    const swap = new Function("location", "document", "fetch", INLINE_SCRIPTS.notFoundSwap);
    const classes: string[] = [];
    const doc = { documentElement: { classList: { add: (c: string) => classes.push(c), remove: () => undefined } } };
    const fetchStub = () => new Promise(() => undefined);

    swap({ pathname: "/belge/" }, doc, fetchStub);
    expect(classes).toEqual([]);
    swap({ pathname: "/en/missing/" }, doc, fetchStub);
    expect(classes).toEqual(["nf-swap"]);
  });

  it("turns on the lite mode for weak devices or the query flag", () => {
    const run = (search: string, nav: Record<string, number>) => {
      const classes: string[] = [];
      const doc = { documentElement: { classList: { add: (c: string) => classes.push(c) } } };
      const motion = new Function("document", "location", "navigator", "matchMedia", INLINE_SCRIPTS.motion);
      motion(doc, { search }, nav, () => ({ matches: false }));
      return classes;
    };

    expect(run("", { hardwareConcurrency: 8, deviceMemory: 8 })).toEqual(["motion"]);
    expect(run("", { hardwareConcurrency: 10 })).toEqual(["motion"]);
    expect(run("", { hardwareConcurrency: 4, deviceMemory: 4 })).toEqual(["motion", "lite"]);
    expect(run("", { hardwareConcurrency: 2 })).toEqual(["motion", "lite"]);
    expect(run("?lite", { hardwareConcurrency: 16 })).toEqual(["motion", "lite"]);
    expect(run("?full", { hardwareConcurrency: 2 })).toEqual(["motion"]);
  });

  it("sends a first visit to English unless the browser asks for Turkish", () => {
    const run = (opts: { languages?: string[]; stored?: string | null; referrer?: string; userAgent?: string }) => {
      const targets: string[] = [];
      const nav = { languages: opts.languages ?? ["en-US"], language: "", userAgent: opts.userAgent ?? "Mozilla/5.0 Safari" };
      const loc = { origin: "https://vivepdf.com", search: "", replace: (u: string) => targets.push(u) };
      const store = { getItem: () => opts.stored ?? null };
      const redirect = new Function("navigator", "document", "location", "localStorage", INLINE_SCRIPTS.langRedirect);
      redirect(nav, { referrer: opts.referrer ?? "" }, loc, store);
      return targets;
    };

    expect(run({})).toEqual(["/en/"]);
    expect(run({ languages: ["de-DE", "fr"] })).toEqual(["/en/"]);
    expect(run({ languages: ["tr-TR"] })).toEqual([]);
    expect(run({ languages: ["en-US", "tr"] })).toEqual([]);
    expect(run({ languages: ["tru"] })).toEqual(["/en/"]);
    expect(run({ stored: "tr" })).toEqual([]);
    expect(run({ referrer: "https://vivepdf.com/en/" })).toEqual([]);
    expect(run({ referrer: "https://vivepdf.com.evil.example/" })).toEqual(["/en/"]);
    expect(run({ referrer: "https://www.google.com/" })).toEqual(["/en/"]);
    expect(run({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" })).toEqual([]);
  });

  it("leaves crawlers without bot in their name on the Turkish home", () => {
    const run = (userAgent: string) => {
      const targets: string[] = [];
      const redirect = new Function("navigator", "document", "location", "localStorage", INLINE_SCRIPTS.langRedirect);
      redirect({ languages: ["en-US"], language: "", userAgent }, { referrer: "" }, { origin: "https://vivepdf.com", search: "", replace: (u: string) => targets.push(u) }, { getItem: () => null });
      return targets;
    };

    expect(run("Mozilla/5.0 (Linux; Android 6.0.1) Chrome/130 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)")).toEqual([]);
    expect(run("Mozilla/5.0 (compatible; GoogleOther)")).toEqual([]);
    expect(run("Mozilla/5.0 (X11; Linux x86_64) Chrome/49.0 Safari/537.36 Google Favicon")).toEqual([]);
    expect(run("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")).toEqual(["/en/"]);
  });
});
