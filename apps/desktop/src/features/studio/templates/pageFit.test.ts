import { describe, expect, it } from "vitest";
import { STUDIO_PAGE_SIZES } from "../model/design";
import { STUDIO_TEMPLATES } from "./catalog";
import { filterForPage, fitsPage, fittingFirst } from "./pageFit";

const businessCard = STUDIO_PAGE_SIZES.businessCardEu;

describe("templates for the open page", () => {
  it("opens a business card on the cards category with business cards first", () => {
    const ordered = fittingFirst(STUDIO_TEMPLATES.filter((template) => template.category === "cards"), businessCard);

    expect(filterForPage(STUDIO_TEMPLATES, businessCard)).toBe("cards");
    expect(ordered[0].id).not.toBe("thankYou");
    expect(ordered.findIndex((template) => !fitsPage(template, businessCard))).toBeGreaterThan(10);
    expect(ordered.slice(0, 10).map((template) => template.id)).toEqual(expect.arrayContaining(["businessCardClassic", "foilBusinessCard"]));
  });

  it("counts a turned page as the same size and opens a story on social media", () => {
    const { width, height } = STUDIO_PAGE_SIZES.a4;

    expect(filterForPage(STUDIO_TEMPLATES, STUDIO_PAGE_SIZES.story)).toBe("social");
    expect(filterForPage(STUDIO_TEMPLATES, { width: height, height: width })).toBe(filterForPage(STUDIO_TEMPLATES, STUDIO_PAGE_SIZES.a4));
  });

  it("keeps all templates for a page no category owns and for no page at all", () => {
    expect(filterForPage(STUDIO_TEMPLATES, STUDIO_PAGE_SIZES.a4)).toBe("all");
    expect(filterForPage(STUDIO_TEMPLATES, { width: 123, height: 77 })).toBe("all");
    expect(filterForPage(STUDIO_TEMPLATES, null)).toBe("all");
    expect(fittingFirst(STUDIO_TEMPLATES, null)).toEqual(STUDIO_TEMPLATES);
  });
});
