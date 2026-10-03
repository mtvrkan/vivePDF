import { describe, expect, it } from "vitest";
import { authorLabelKey, bulkPresetTexts, longDate, templateDefaults, titleLabelKey, withPlaceholder } from "./createDocument";

describe("templateDefaults", () => {
  it("gives formal and long-form templates a serif font and the booklet A5 paper", () => {
    expect(templateDefaults("petition", "letter")).toEqual({ font: "serif", paper: "letter", fontSize: 11 });
    expect(templateDefaults("booklet", "a4")).toEqual({ font: "serif", paper: "a5", fontSize: 10 });
    expect(templateDefaults("lectureNotes", "a4")).toEqual({ font: "sans", paper: "a4", fontSize: 10.5 });
  });

  it("goes back to A4 when leaving the booklet", () => {
    expect(templateDefaults("report", "a5").paper).toBe("a4");
  });
});

describe("field labels", () => {
  it("names the title and author fields after what each template needs", () => {
    expect([titleLabelKey("petition"), authorLabelKey("petition")]).toEqual(["tools.create.fields.addressee", "tools.create.fields.signer"]);
    expect([titleLabelKey("letter"), authorLabelKey("letter")]).toEqual(["tools.create.fields.subject", "tools.create.fields.sender"]);
    expect(authorLabelKey("minutes")).toBe("tools.create.fields.attendees");
    expect([titleLabelKey("report"), authorLabelKey("report")]).toEqual(["tools.create.fields.title", "tools.create.fields.author"]);
  });
});

describe("longDate", () => {
  it("writes the date out in the interface language", () => {
    expect(longDate(new Date(2026, 9, 3), "tr")).toBe("3 Ekim 2026");
    expect(longDate(new Date(2026, 9, 3), "en")).toBe("October 3, 2026");
  });
});

describe("withPlaceholder", () => {
  it("adds a column placeholder after a space, or alone in an empty field", () => {
    expect(withPlaceholder("", "Ad Soyad")).toBe("{Ad Soyad}");
    expect(withPlaceholder("Sayın", "Ad")).toBe("Sayın {Ad}");
    expect(withPlaceholder("Sayın ", "Ad")).toBe("Sayın {Ad}");
  });
});

describe("bulkPresetTexts", () => {
  it("fills the heading and text of certificates and leaves badges to the user", () => {
    const translate = (key: string) => `<${key}>`;
    expect(bulkPresetTexts("certificate", translate)).toEqual({ heading: "<tools.create.bulk.kinds.certificate.heading>", recipient: "", body: "<tools.create.bulk.kinds.certificate.body>", details: "" });
    expect(bulkPresetTexts("badge", translate)).toEqual({ heading: "", recipient: "", body: "", details: "" });
  });
});
