import { describe, expect, it } from "vitest";
import { formatMonthYear, parseMonthYear } from "./cvDates";
import { applyImport } from "./cvImport";
import { CV_FILE_FORMAT, CV_LIMITS, cvFromJson, cvToJson, defaultTheme, emptyExperience, emptyProfile, fromLegacyDraft, normalizeProfile, splitListText } from "./cvModel";

describe("cv profile data", () => {
  it("keeps a valid photo crop and the education 'still studying' flag, and drops a broken crop", () => {
    const profile = normalizeProfile({ photo: "C:/p.png", photoCrop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, education: [{ degree: "BSc", current: true }] });
    const broken = normalizeProfile({ photoCrop: { x: 0.8, y: 0, width: 0.5, height: 0.5 } });

    expect(profile.photoCrop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    expect(profile.education[0].current).toBe(true);
    expect(broken.photoCrop).toBeNull();
  });

  it("round-trips a CV through its JSON file without ids", () => {
    const profile = { ...emptyProfile(), name: "Ayşe", experience: [{ ...emptyExperience(), role: "Designer", current: true }] };
    const theme = { ...defaultTheme("tr"), layout: "classic" as const, accent: "#0f766e" };

    const text = cvToJson({ profile, theme });
    const back = cvFromJson(text, "en");

    expect(JSON.parse(text).format).toBe(CV_FILE_FORMAT);
    expect(text).not.toContain('"id"');
    expect(back?.profile.name).toBe("Ayşe");
    expect(back?.profile.experience[0]).toMatchObject({ role: "Designer", current: true });
    expect(back?.theme).toMatchObject({ layout: "classic", accent: "#0f766e", language: "tr" });
  });

  it("refuses files from a newer version or that are not CVs, and accepts a bare profile", () => {
    expect(cvFromJson(JSON.stringify({ format: CV_FILE_FORMAT, version: 99, profile: {} }), "en")).toBeNull();
    expect(cvFromJson("not json", "en")).toBeNull();
    expect(cvFromJson("[1,2]", "en")).toBeNull();
    expect(cvFromJson(JSON.stringify({ name: "Kim", experience: [] }), "en")?.profile.name).toBe("Kim");
  });

  it("splits a pasted list on commas, semicolons, bullets and new lines", () => {
    expect(splitListText("Figma, Sketch; - Photoshop\n• Illustrator | Excel\n\n")).toEqual(["Figma", "Sketch", "Photoshop", "Illustrator", "Excel"]);
  });

  it("moves an old draft into the new shape", () => {
    const state = fromLegacyDraft(JSON.stringify({ name: "Kim", education: [{ title: "BSc", period: "2014 - 2018" }] }), "en");

    expect(state?.profile.education[0]).toMatchObject({ degree: "BSc", start: "2014", end: "2018", current: false });
  });
});

describe("cv month and year", () => {
  it("reads years, numbers and month names in the CV language or English", () => {
    expect(parseMonthYear("2021", "tr")).toEqual({ month: null, year: 2021 });
    expect(parseMonthYear("03/2019", "en")).toEqual({ month: 3, year: 2019 });
    expect(parseMonthYear("Ocak 2020", "tr")).toEqual({ month: 1, year: 2020 });
    expect(parseMonthYear("Sep 2018", "tr")).toEqual({ month: 9, year: 2018 });
    expect(parseMonthYear(formatMonthYear({ month: 5, year: 2022 }, "de"), "de")).toEqual({ month: 5, year: 2022 });
  });

  it("leaves free text and impossible dates alone", () => {
    expect(parseMonthYear("Summer 2019", "en")).toBeNull();
    expect(parseMonthYear("13/2019", "en")).toBeNull();
    expect(parseMonthYear("1800", "en")).toBeNull();
    expect(parseMonthYear("", "en")).toBeNull();
  });
});

describe("importing a CV into the form", () => {
  const current = { ...emptyProfile(), name: "Me", summary: "Mine", experience: [{ ...emptyExperience(), role: "Old" }, emptyExperience()] };
  const imported = { name: "Imported", headline: "Engineer", summary: "Theirs", experience: [{ role: "New" }], skills: [{ name: "Go", level: 0 }] };

  it("replaces only the chosen sections", () => {
    const next = applyImport(current, imported, new Set(["personal", "experience"]), "replace");

    expect(next.name).toBe("Imported");
    expect(next.summary).toBe("Mine");
    expect(next.experience.map((item) => item.role)).toEqual(["New"]);
    expect(next.skills).toEqual([]);
  });

  it("adds to what is there, dropping empty entries and keeping filled text", () => {
    const next = applyImport(current, imported, new Set(["personal", "summary", "experience", "skills"]), "add");

    expect(next.name).toBe("Me");
    expect(next.headline).toBe("Engineer");
    expect(next.summary).toBe("Mine\n\nTheirs");
    expect(next.experience.map((item) => item.role)).toEqual(["Old", "New"]);
    expect(next.skills.map((item) => item.name)).toEqual(["Go"]);
  });

  it("never goes past a section's limit", () => {
    const many = { experience: Array.from({ length: CV_LIMITS.experience + 5 }, (_, index) => ({ role: `R${index}` })) };

    expect(applyImport(current, many, new Set(["experience"]), "add").experience).toHaveLength(CV_LIMITS.experience);
  });
});
