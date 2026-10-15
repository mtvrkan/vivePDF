import { describe, expect, it } from "vitest";
import { formatMonthYear, parseMonthYear } from "./cvDates";
import { applyImport } from "./cvImport";
import { CV_FILE_FORMAT, CV_LIMITS, cvFromJson, cvToJson, defaultTheme, emptyExperience, emptyLeveled, emptyProfile, fromLegacyDraft, isStoredPhoto, normalizeProfile, splitListText } from "./cvModel";

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

  it("reads Turkish month names typed in capitals or without Turkish letters", () => {
    expect(parseMonthYear("MAYIS 2016", "tr")).toEqual({ month: 5, year: 2016 });
    expect(parseMonthYear("ARALIK 2019", "en")).toEqual({ month: 12, year: 2019 });
    expect(parseMonthYear("Mayis 2016", "tr")).toEqual({ month: 5, year: 2016 });
    expect(parseMonthYear("EKİM 2020", "tr")).toEqual({ month: 10, year: 2020 });
  });

  it("reads a year and month written as 2019-03, as PDF import returns it", () => {
    expect(parseMonthYear("2019-03", "en")).toEqual({ month: 3, year: 2019 });
    expect(parseMonthYear("2019/12", "en")).toEqual({ month: 12, year: 2019 });
    expect(parseMonthYear("2015-16", "en")).toBeNull();
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

describe("cv ids, periods and photos", () => {
  it("keeps item ids through normalising and gives a duplicate or broken id a new one", () => {
    const skill = { ...emptyLeveled(), name: "SQL" };

    const profile = normalizeProfile({ skills: [skill, { ...skill, name: "Copy" }, { id: "bad id!", name: "Odd" }] });

    expect(profile.skills[0].id).toBe(skill.id);
    expect(profile.skills[1].id).not.toBe(skill.id);
    expect(profile.skills[2].id).not.toBe("bad id!");
  });

  it("splits an old draft period only on the range dash, not inside numeric dates", () => {
    const periods = ["03-2019 - 05-2021", "2019-2021", "03-2019-05-2021", "2020 – Present", "03-2019"];

    const state = fromLegacyDraft(JSON.stringify({ name: "Kim", experience: periods.map((period) => ({ title: "Role", period })) }), "en");

    expect(state?.profile.experience.map((item) => [item.start, item.end])).toEqual([
      ["03-2019", "05-2021"],
      ["2019", "2021"],
      ["03-2019", "05-2021"],
      ["2020", "Present"],
      ["03-2019", ""],
    ]);
  });

  it("writes the photo into the CV file instead of its path and reads it back", () => {
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const profile = { ...emptyProfile(), name: "Ayşe", photo: "C:/Users/someone/Pictures/me.jpg", photoCrop: crop };

    const withPhoto = cvToJson({ profile, theme: defaultTheme("en") }, "aGVsbG8=");
    const withoutPhoto = cvToJson({ profile, theme: defaultTheme("en") });

    expect(withPhoto).not.toContain("Pictures");
    expect(cvFromJson(withPhoto, "en")).toMatchObject({ photoData: "aGVsbG8=", profile: { photo: null, photoCrop: crop } });
    expect(cvFromJson(withoutPhoto, "en")).toMatchObject({ photoData: null, profile: { photo: null, photoCrop: null } });
    expect(cvFromJson(JSON.stringify({ profile: { name: "Kim", photoData: "<script>" } }), "en")?.photoData).toBeNull();
  });

  it("tells a photo in the app's image store from a picked file", () => {
    expect(isStoredPhoto(["C:", "Users", "a", "AppData", "Roaming", "vivepdf", "studio-images", `${"a".repeat(32)}.jpg`].join("\\"))).toBe(true);
    expect(isStoredPhoto("/home/a/.local/share/vivepdf/studio-images/0123456789abcdef0123456789abcdef.png")).toBe(true);
    expect(isStoredPhoto("C:/Users/a/Pictures/me.jpg")).toBe(false);
  });
});
