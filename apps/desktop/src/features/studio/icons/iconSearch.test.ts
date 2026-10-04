import { describe, expect, it } from "vitest";
import { FEATURED_ICONS, iconEntry, searchIcons, splitIconName } from "./iconSearch";

const NAMES = ["Heart", "HeartCrack", "HeartHandshake", "CircleCheck", "Check", "CheckCheck", "Mail", "MailOpen", "MapPin", "House", "Star", "ArrowRight", "ChevronLeft", "Banknote", "Grid2x2", "Heading1", "ALargeSmall", "Circle", "SquareDashed", "Coffee", "Sun", "Search"];
const ENTRIES = NAMES.map(iconEntry);
const names = (query: string, options?: Parameters<typeof searchIcons>[2]) => searchIcons(ENTRIES, query, options).map((entry) => entry.name);

describe("icon names", () => {
  it("splits Lucide component names into words and a readable label", () => {
    expect(splitIconName("AlarmClockCheck")).toEqual(["alarm", "clock", "check"]);
    expect(splitIconName("Grid2x2")).toEqual(["grid", "2x2"]);
    expect(splitIconName("Heading1")).toEqual(["heading", "1"]);
    expect(splitIconName("ALargeSmall")).toEqual(["a", "large", "small"]);
    expect(iconEntry("MapPin")).toMatchObject({ label: "Map pin", slug: "map-pin" });
  });

  it("puts icons into categories by their words", () => {
    expect(iconEntry("ArrowRight").categories).toContain("arrows");
    expect(iconEntry("Circle").categories).toContain("shapes");
    expect(iconEntry("SquareDashed").categories).toContain("shapes");
    expect(iconEntry("CircleCheck").categories).not.toContain("shapes");
    expect(iconEntry("Coffee").categories).toEqual(["food"]);
  });
});

describe("icon search", () => {
  it("ranks the exact name first, then names starting with the word, then other matches", () => {
    expect(names("heart").slice(0, 3)).toEqual(["Heart", "HeartCrack", "HeartHandshake"]);
    expect(names("check")[0]).toBe("Check");
    expect(names("check")).toEqual(expect.arrayContaining(["CheckCheck", "CircleCheck"]));
    expect(names("map pin")[0]).toBe("MapPin");
    expect(names("map-pin")).toEqual(["MapPin"]);
  });

  it("needs every word to match and accepts prefixes", () => {
    expect(names("heart hand")).toEqual(["HeartHandshake"]);
    expect(names("hea")[0]).toBe("Heart");
    expect(names("zzz")).toEqual([]);
  });

  it("finds icons by English synonyms and by localised keywords", () => {
    expect(names("love")[0]).toBe("Heart");
    expect(names("email")).toEqual(expect.arrayContaining(["Mail", "MailOpen"]));
    expect(names("money")).toContain("Banknote");
    expect(names("kalp", { local: { heart: ["kalp", "sevgi"] } })[0]).toBe("Heart");
    expect(names("kahve", { local: { food: ["Yiyecek ve içecek", "kahve"] } })).toEqual(["Coffee"]);
    expect(names("işaret", { local: { check: ["İşaret", "tamam"] } })[0]).toBe("Check");
  });

  it("filters by category and matches localised category names", () => {
    expect(names("", { category: "arrows" }).sort()).toEqual(["ArrowRight", "ChevronLeft"]);
    expect(names("circle", { category: "shapes" })).toEqual(["Circle"]);
    expect(names("Formen", { local: { shapes: ["Formen"] } })).toEqual(expect.arrayContaining(["Circle", "SquareDashed"]));
  });

  it("shows featured icons first when there is no query", () => {
    const order = names("");
    const featured = order.filter((name) => (FEATURED_ICONS as readonly string[]).includes(name));
    expect(order.slice(0, featured.length)).toEqual(featured);
    expect(order[0]).toBe("Heart");
    expect(order).toHaveLength(NAMES.length);
  });
});
