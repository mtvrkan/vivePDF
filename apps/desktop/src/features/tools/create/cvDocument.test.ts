import { describe, expect, it } from "vitest";
import { cvParams, emptyCvDraft, emptyEntry, linesOf, movedItem, parseCvDraft, skillsOf } from "./cvDocument";

const labels = { summary: "Profil", experience: "Deneyim", education: "Eğitim", skills: "Beceriler", languages: "Diller", contact: "İletişim" };

describe("parseCvDraft", () => {
  it("restores a stored draft and gives every entry a fresh id", () => {
    const stored = { ...emptyCvDraft("en"), template: "modern", name: "Deniz", experience: [{ title: "Engineer", organisation: "Acme" }], language: "de" };

    const draft = parseCvDraft(JSON.stringify(stored), "tr");

    expect(draft.template).toBe("modern");
    expect(draft.language).toBe("de");
    expect(draft.name).toBe("Deniz");
    expect(draft.experience[0]).toMatchObject({ title: "Engineer", organisation: "Acme", location: "", details: "" });
    expect(draft.experience[0].id).toMatch(/^cv-/);
  });

  it("falls back to an empty draft for broken or foreign values", () => {
    expect(parseCvDraft("{not json", "tr")).toMatchObject({ name: "", language: "tr", template: "classic" });
    const odd = parseCvDraft(JSON.stringify({ template: "fancy", accent: "red", font: "comic", paper: "a3", language: "xx", photo: 5 }), "en");
    expect(odd).toMatchObject({ template: "classic", accent: "#1f4e79", font: "sans", paper: "a4", language: "en", photo: null });
  });
});

describe("list helpers", () => {
  it("splits contacts by line and skills by comma, semicolon or line", () => {
    expect(linesOf(" a@b.c \n\n+90 555\n", 8)).toEqual(["a@b.c", "+90 555"]);
    expect(skillsOf("Python, SQL;Docker\nGit,,")).toEqual(["Python", "SQL", "Docker", "Git"]);
  });

  it("moves an item within bounds only", () => {
    expect(movedItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    const items = [1, 2];
    expect(movedItem(items, 1, 1)).toBe(items);
  });
});

describe("cvParams", () => {
  it("drops empty entries and sections and strips the draft ids", () => {
    const draft = {
      ...emptyCvDraft("tr"),
      name: "Deniz",
      contacts: "deniz@example.com\nİzmir",
      experience: [{ ...emptyEntry(), title: "Engineer" }, emptyEntry()],
      sections: [{ id: "x", heading: "Hobbies", body: "Chess" }, { id: "y", heading: "Empty", body: " " }],
      skills: "Python, SQL",
    };

    const params = cvParams(draft, labels, "C:/out/cv.pdf");

    expect(params.experience).toEqual([{ title: "Engineer", organisation: "", location: "", period: "", details: "" }]);
    expect(params.education).toEqual([]);
    expect(params.sections).toEqual([{ heading: "Hobbies", body: "Chess" }]);
    expect(params.contacts).toEqual(["deniz@example.com", "İzmir"]);
    expect(params.skills).toEqual(["Python", "SQL"]);
    expect(params.photo).toBeUndefined();
    expect(params.labels).toBe(labels);
  });
});
