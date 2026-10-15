import { beforeAll, describe, expect, it } from "vitest";
import i18n, { ready, translatorFor } from "@/app/i18n";
import { LOCALE_CODES } from "@/app/locales";
import { HELP_TOPICS, HELP_TOPIC_IDS, helpTopicFor, isHelpTopicKey, matchingTopics } from "./helpTopics";

describe("help topics", () => {
  beforeAll(async () => {
    await ready();
  });

  it.each(LOCALE_CODES)("has every title, summary and step in %s and nothing past the last step", async (locale) => {
    const t = await translatorFor(locale);
    const has = (key: string) => typeof i18n.getResource(locale, "common", key) === "string";

    for (const topic of HELP_TOPICS) {
      const base = `help.topics.${topic.id}`;
      const keys = ["title", "summary", ...Array.from({ length: topic.steps }, (_, index) => `step${index + 1}`)];
      for (const key of keys) expect(has(`${base}.${key}`), `${locale} ${base}.${key}`).toBe(true);
      expect(has(`${base}.step${topic.steps + 1}`), `${locale} ${base} extra step`).toBe(false);
      expect(t(`${base}.title`)).not.toContain("{{");
    }
  });

  it("lists each topic once", () => {
    expect(HELP_TOPICS.map((topic) => topic.id)).toEqual([...HELP_TOPIC_IDS]);
  });

  it("maps screens to topics, with the presentation winning over the route", () => {
    expect(helpTopicFor("/pages", false, null)).toBe("organizePages");
    expect(helpTopicFor("/tools/merge", false, null)).toBe("organizePages");
    expect(helpTopicFor("/studio", false, "design")).toBe("studioDesign");
    expect(helpTopicFor("/studio", false, null)).toBe("studioDesign");
    expect(helpTopicFor("/viewer", true, null)).toBe("presentation");
    expect(helpTopicFor("/tools/compress", false, null)).toBe("openView");
  });

  it("matches every word of the search in Turkish without the dotted and dotless i getting in the way", async () => {
    const t = await translatorFor("tr");

    expect(matchingTopics(t, "IMZA dogrula").map((topic) => topic.id)).toEqual(["sign"]);
    expect(matchingTopics(t, "   ")).toHaveLength(HELP_TOPICS.length);
    expect(matchingTopics(t, "imza zzqx")).toEqual([]);
  });

  it("takes only a plain Shift+F1 as the help key", () => {
    const key = (init: KeyboardEventInit) => isHelpTopicKey(new KeyboardEvent("keydown", init));

    expect(key({ key: "F1", shiftKey: true })).toBe(true);
    expect(key({ key: "F1" })).toBe(false);
    expect(key({ key: "F1", shiftKey: true, ctrlKey: true })).toBe(false);
    expect(key({ key: "F1", shiftKey: true, repeat: true })).toBe(false);
  });
});
