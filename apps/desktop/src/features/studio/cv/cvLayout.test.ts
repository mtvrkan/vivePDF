import { describe, expect, it } from "vitest";
import type { StudioElement, StudioTextElement } from "@/types/studio";
import type { Locale } from "@/types";
import { textOf } from "../model/design";
import { formatMonthYear } from "./cvDates";
import { composeCvReport, contrast, legible, MAX_CV_PAGES, onFill } from "./cvLayout";
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

  it("carries a long summary and custom section over to the next page word by word", () => {
    const words = Array.from({ length: 1400 }, (_, index) => `word${index}`).join(" ");
    const profile = { ...emptyProfile(), name: "Alex", summary: words, custom: [{ id: cvId(), heading: "Notes", body: bullets(90, "Note") }] };

    const { design, overflow } = compose(profile);
    const everything = design.pages.map((_, page) => allText(design, page)).join("\n");

    expect(design.pages.length).toBeGreaterThan(1);
    expect(overflow.items).toBe(0);
    expect(everything).toContain("word0 ");
    expect(everything).toContain("word1399");
    expect(everything).toContain("Note achievement number 90 ");
  });

  it("counts a block taller than a whole page as left out instead of drawing it past the edge", () => {
    const tall = Array.from({ length: 400 }, () => "x").join("\n");
    const profile = { ...emptyProfile(), name: "Alex", certificates: [{ id: cvId(), name: tall, issuer: "", date: "" }] };

    const { design, overflow } = compose(profile);

    expect(overflow.sections).toContain("certificates");
    for (const page of design.pages) for (const element of page.elements) expect(element.y + Math.min(element.height, 1)).toBeLessThanOrEqual(page.height);
  });

  it("writes entry dates in the CV language whichever language they were typed in", () => {
    const profile = { ...emptyProfile(), name: "Alex", experience: [{ ...emptyExperience(), role: "Role", start: "Mart 2021", end: "October 2023" }] };
    const theme = { ...defaultTheme("de"), layout: "minimal" as const };

    const { design } = composeCvReport(specOf("minimal"), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });

    expect(allText(design, 0)).toContain(`${formatMonthYear({ month: 3, year: 2021 }, "de")} – ${formatMonthYear({ month: 10, year: 2023 }, "de")}`);
    expect(allText(design, 0)).not.toContain("Mart");
  });

  it("mirrors the page for a right-to-left CV language", () => {
    const profile = { ...emptyProfile(), name: "Alex", experience: [{ ...emptyExperience(), role: "Role", start: "March 2021", end: "" }] };
    const input = (language: Locale) => ({ profile, theme: { ...defaultTheme(language), layout: "minimal" as const }, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });
    const named = (elements: StudioElement[]) => elements.find((element): element is StudioTextElement => element.kind === "text" && textOf(element.runs) === "Alex");

    const ltr = composeCvReport(specOf("minimal"), input("en")).design.pages[0];
    const rtl = composeCvReport(specOf("minimal"), input("ar")).design.pages[0];
    const left = named(ltr.elements);
    const right = named(rtl.elements);

    expect(left?.align).toBe("left");
    expect(right?.align).toBe("right");
    expect(right && left && right.x + right.width).toBeCloseTo(ltr.width - (left?.x ?? 0), 3);
    for (const element of rtl.elements) expect(element.x + element.width).toBeLessThanOrEqual(rtl.width + 0.5);
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

describe("cv overflow and colour fixes", () => {
  const paragraph = (words: number) => Array.from({ length: words }, (_, index) => `word${index}`).join(" ");
  const everything = (design: ReturnType<typeof compose>["design"]) => design.pages.map((_, page) => allText(design, page)).join("\n");
  const texts = (elements: StudioElement[]) => elements.filter((element): element is StudioTextElement => element.kind === "text");

  it("carries one long paragraph over the page break word by word and keeps the sections after it", () => {
    for (const layout of ["compact", "modern", "corporate", "tech"] as const) {
      const profile = { ...withExperience([paragraph(700)]), education: [{ id: cvId(), degree: "Degree after", school: "School", location: "", start: "", end: "", current: false, details: "" }] };
      const theme = { ...defaultTheme("en"), layout, paper: "letter" as const, density: "roomy" as const };

      const { design, overflow } = composeCvReport(specOf(layout), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });

      expect(overflow, layout).toEqual({ items: 0, sections: [] });
      expect(everything(design), layout).toContain("word699");
      expect(everything(design), layout).toContain("Degree after");
      expect(allText(design, design.pages.length - 1).trim(), layout).not.toBe("");
    }
  });

  it("wraps a long chip list onto the next page instead of dropping it and the sections after it", () => {
    const skills = Array.from({ length: 160 }, (_, index) => ({ id: cvId(), name: `Advanced Skill Name ${index}`, level: 3 }));
    const profile = { ...emptyProfile(), name: "Alex", skills, languages: [{ id: cvId(), name: "Turkish", level: 5 }] };
    const theme = { ...defaultTheme("en"), layout: "creative" as const, skillStyle: "chips" as const };

    const { design, overflow } = composeCvReport(specOf("creative"), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });

    expect(overflow).toEqual({ items: 0, sections: [] });
    expect(design.pages.length).toBeGreaterThan(1);
    expect(everything(design)).toContain("Advanced Skill Name 159");
    expect(everything(design)).toContain("Turkish");
  });

  it("keeps later sections when one item is too tall for any page", () => {
    const tall = Array.from({ length: 400 }, () => "x").join("\n");
    const profile = { ...emptyProfile(), name: "Alex", certificates: [{ id: cvId(), name: tall, issuer: "", date: "" }, { id: cvId(), name: "Short cert", issuer: "", date: "" }], interests: "Chess" };

    const { design, overflow } = compose(profile);

    expect(overflow.items).toBe(1);
    expect(everything(design)).toContain("Short cert");
    expect(everything(design)).toContain("Chess");
  });

  it("keeps the header text inside its band when the name and contacts run long", () => {
    for (const layout of ["tech", "corporate", "executive"] as const) {
      const profile = {
        ...withExperience(["- Built things"]),
        name: "Alexandra Bartholomew-Fitzgerald Montgomery-Wellington Featherstonehaugh",
        headline: "Principal Platform Engineer and Distributed Systems Architect",
        contacts: ["alexandra.bartholomew@example.com", "+44 20 7946 0958", "linkedin.com/in/alexandra-bartholomew", "github.com/alexandra-bartholomew"].map((value, index) => ({ id: cvId(), kind: (["email", "phone", "linkedin", "github"] as const)[index], value })),
      };

      const page = compose(profile, layout).design.pages[0];
      const name = texts(page.elements).find((element) => textOf(element.runs) === profile.name);
      const title = texts(page.elements).find((element) => textOf(element.runs) === "experience");

      expect(name && title, layout).toBeTruthy();
      const header = texts(page.elements).filter((element) => element.y < (title?.y ?? 0) && element.x < page.width - 200);
      for (const element of header) expect(element.y + element.height, layout).toBeLessThanOrEqual((title?.y ?? 0) - 10);
    }
  });

  it("indents the rest of an undated entry the same as its first part on a date column layout", () => {
    const profile = { ...emptyProfile(), name: "Alex", experience: [{ ...emptyExperience(), role: "Undated role", details: bullets(80, "Line") }] };

    const { design } = compose(profile, "minimal");
    const firstBody = texts(design.pages[0].elements).find((element) => textOf(element.runs).includes("Line achievement number 1 "));
    const restBody = texts(design.pages[1]?.elements ?? []).find((element) => textOf(element.runs).includes("Line achievement"));

    expect(firstBody && restBody).toBeTruthy();
    expect(restBody?.x).toBeCloseTo(firstBody?.x ?? 0, 3);
  });

  it("tags every text with the CV language so Studio cases and measures it the same way", () => {
    const profile = withExperience(["- Built things"]);
    const theme = { ...defaultTheme("tr"), layout: "infographic" as const };

    const { design } = composeCvReport(specOf("infographic"), { profile, theme, labels: cvLabels(t), measure: estimateMeasure, emptyPhoto: false, name: "CV" });

    for (const element of texts(design.pages.flatMap((page) => page.elements))) expect(element.language).toBe("tr");
  });

  it("moves a colour away from its background until it can be read", () => {
    expect(contrast(legible("#111827", "#1e293b", 3), "#1e293b")).toBeGreaterThanOrEqual(3);
    expect(contrast(legible("#38bdf8", "#ffffff", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(legible("#0f172a", "#ffffff", 4.5)).toBe("#0f172a");
    expect(onFill("#0f172a")).toBe("#ffffff");
    expect(onFill("#a5f3fc")).toBe("#0f172a");
  });
});
