import { describe, expect, it } from "vitest";
import { buildVCard, EMPTY_VCARD, isVCard, parseVCard } from "./vcard";

const ada = { ...EMPTY_VCARD, firstName: "Ada", lastName: "Lovelace", organization: "Analytical, Ltd.", title: "Engineer", phone: "+44 20 1234", mobile: "+44 7700 900", email: "ada@example.com", website: "https://example.com", address: "12 St James's Sq; London" };

describe("vCard contact codes", () => {
  it("writes a vCard 3.0 with only the filled fields and reads it back", () => {
    const text = buildVCard(ada);

    expect(text.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Lovelace;Ada;;;",
      "FN:Ada Lovelace",
      "ORG:Analytical\\, Ltd.",
      "TITLE:Engineer",
      "TEL;TYPE=WORK,VOICE:+44 20 1234",
      "TEL;TYPE=CELL:+44 7700 900",
      "EMAIL;TYPE=INTERNET:ada@example.com",
      "URL:https://example.com",
      "ADR;TYPE=WORK:;;12 St James's Sq\\; London;;;;",
      "END:VCARD",
    ]);
    expect(parseVCard(text)).toEqual(ada);
    expect(buildVCard({ ...EMPTY_VCARD, organization: "Acme" })).toContain("FN:Acme");
  });

  it("reads folded lines, line feeds and escaped breaks from other apps", () => {
    const text = "BEGIN:VCARD\nVERSION:4.0\nN:Hopper;Grace;;;\nTITLE:Rear\n  Admiral\\nRetired\nTEL;TYPE=cell:123\nEND:VCARD";

    expect(parseVCard(text)).toMatchObject({ firstName: "Grace", lastName: "Hopper", title: "Rear Admiral\nRetired", mobile: "123", phone: "" });
  });

  it("leaves plain text and links alone", () => {
    expect(isVCard("https://example.com")).toBe(false);
    expect(parseVCard("BEGIN something else")).toBeNull();
    expect(isVCard(" begin:vcard\r\nEND:VCARD")).toBe(true);
  });
});
