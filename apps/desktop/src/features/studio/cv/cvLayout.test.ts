import { describe, expect, it } from "vitest";
import { textOf } from "../model/design";
import { composeCvReport, MAX_CV_PAGES } from "./cvLayout";
import { specOf } from "./cvDesigns";
import { cvId, defaultTheme, emptyExperience, emptyProfile, type CvLayoutId, type CvProfile } from "./cvModel";
import { cvLabels, estimateMeasure } from "./cvSample";

const t = (key: string) => key.split(".").pop() ?? key;

function compose(profile: CvProfile, layout: CvLayoutId = "minimal") {
  const theme = { ...defaultTheme("en"), layout };
  return composeCvReport(specOf(layout), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });
}

function bullets(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `- ${prefix} achievement number ${index + 1} with enough words to fill a line`).join("\n");
}

function withExperience(details: string[]): CvProfile {
  return { ...emptyProfile(), name: "Alex", experience: details.map((text, index) => ({ ...emptyExperience(), role: `Role ${index + 1}`, organisation: "Company", details: text })) };
}

const allText = (design: ReturnType<typeof compose>["design"], page: number) =>
  design.pages[page].elements.map((element) => (element.kind === "text" ? textOf(element.runs) : "")).join("\n");

describe("cv pagination", () => {
  it("keeps a short CV on one page with nothing left out", () => {
    const { design, overflow } = compose(withExperience(["- Built things"]));

    expect(design.pages).toHaveLength(1);
    expect(overflow).toEqual({ items: 0, sections: [] });
  });

  it("splits a long entry at a line boundary and carries the rest to the next page", () => {
    const { design, overflow } = compose(withExperience([bullets(30, "First"), bullets(60, "Second")]));

    expect(design.pages.length).toBeGreaterThan(1);
    expect(overflow.items).toBe(0);
    const secondFirstPage = allText(design, 0);
    const secondNextPage = allText(design, 1);
    expect(secondFirstPage).toContain("Second achievement number 1 ");
    expect(secondNextPage).toMatch(/Second achievement number \d+ /);
    expect(secondNextPage).not.toContain("Role 2");
  });

  it("splits entries on the timeline layout too", () => {
    const { design, overflow } = compose(withExperience([bullets(90, "Long")]), "timeline");

    expect(design.pages.length).toBeGreaterThan(1);
    expect(overflow.items).toBe(0);
  });

  it("reports what was left out past the page limit", () => {
    const profile = { ...withExperience(Array.from({ length: 30 }, () => bullets(45, "Many"))), certificates: [{ id: cvId(), name: "Cert", issuer: "", date: "" }] };

    const { design, overflow } = compose(profile);

    expect(design.pages).toHaveLength(MAX_CV_PAGES);
    expect(overflow.items).toBeGreaterThan(0);
    expect(overflow.sections).toContain("experience");
  });
});
