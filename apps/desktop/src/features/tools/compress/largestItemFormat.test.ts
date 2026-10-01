import { describe, expect, it } from "vitest";
import { fontFormatName, imageFormatName, pageList } from "./largestItemFormat";

describe("imageFormatName", () => {
  it("names well-known image codecs directly", () => {
    expect(imageFormatName("jpeg")).toEqual({ name: "JPEG" });
    expect(imageFormatName("jpeg2000")).toEqual({ name: "JPEG 2000" });
  });

  it("sends lossless, raw and unknown storage to translated labels", () => {
    expect(imageFormatName("flate")).toEqual({ key: "tools.compress.largest.formats.flate" });
    expect(imageFormatName("none")).toEqual({ key: "tools.compress.largest.formats.none" });
    expect(imageFormatName("other")).toEqual({ key: "tools.compress.largest.formats.other" });
  });
});

describe("fontFormatName", () => {
  it("names every font program format", () => {
    expect(fontFormatName("truetype")).toBe("TrueType");
    expect(fontFormatName("type1")).toBe("Type 1");
  });
});

describe("pageList", () => {
  it("lists every page when there are few", () => {
    expect(pageList([1, 3], String)).toBe("1, 3");
  });

  it("cuts a long list with an ellipsis", () => {
    expect(pageList([1, 2, 3, 4, 5, 6, 7], String)).toBe("1, 2, 3, 4, 5 …");
  });

  it("gives an empty string when the image is on no page", () => {
    expect(pageList([], String)).toBe("");
  });
});
