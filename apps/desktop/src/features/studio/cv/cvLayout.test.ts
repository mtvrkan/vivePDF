import { describe, expect, it } from "vitest";
import { textOf } from "../model/design";
import { composeCvReport, MAX_CV_PAGES } from "./cvLayout";
import { specOf } from "./cvDesigns";
import { CV_LAYOUT_IDS, cvId, defaultTheme, emptyExperience, emptyProfile, type CvLayoutId, type CvProfile } from "./cvModel";
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

describe("cv designs", () => {
  const sample = (): CvProfile => ({
    ...withExperience([bullets(3, "Sample"), bullets(2, "Earlier")]),
    headline: "Designer",
    contacts: [
      { id: cvId(), kind: "email", value: "alex@example.com" },
      { id: cvId(), kind: "phone", value: "+44 20 7946 0958" },
      { id: cvId(), kind: "linkedin", value: "linkedin.com/in/alex" },
    ],
    skills: [1, 2, 3, 4, 5].map((level) => ({ id: cvId(), name: `Skill ${level}`, level })),
  });

  it("lays out a sample profile on every layout without leaving anything out or leaving the page", () => {
    for (const layout of CV_LAYOUT_IDS) {
      const { design, overflow } = compose(sample(), layout);

      expect(overflow, layout).toEqual({ items: 0, sections: [] });
      expect(design.pages.length, layout).toBeLessThanOrEqual(2);
      for (const page of design.pages) {
        for (const element of page.elements) {
          expect(element.x + element.width, `${layout} ${element.kind}`).toBeLessThanOrEqual(page.width + 0.5);
          expect(element.y, `${layout} ${element.kind}`).toBeLessThan(page.height);
        }
      }
    }
  });

  it("draws an icon before each contact on layouts that use contact icons", () => {
    const { design } = compose(sample(), "executive");

    const icons = design.pages[0].elements.filter((element) => element.kind === "vector" && ["email", "phone", "linkedin"].includes(element.name));
    expect(icons).toHaveLength(3);
  });

  it("splits a skill level into five segments and keeps plain contact text on the ATS layout", () => {
    const segmented = compose({ ...sample(), skills: [{ id: cvId(), name: "Research", level: 3 }] }, "infographic").design.pages[0].elements;
    const ats = compose(sample(), "ats").design.pages[0].elements;

    const segments = segmented.filter((element) => element.kind === "shape" && element.width < 40 && Math.abs(element.height - 4.5) < 0.01);
    expect(segments).toHaveLength(5);
    expect(ats.some((element) => element.kind === "vector")).toBe(false);
  });
});
