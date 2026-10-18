import { describe, expect, it } from "vitest";
import { thumbnailDataUrl } from "./thumbnail";

const BASE = { image: "AAAA", width: 10, height: 12, pageCount: 1 };

describe("thumbnailDataUrl", () => {
  it("labels a JPEG preview as JPEG", () => {
    expect(thumbnailDataUrl({ ...BASE, format: "jpeg" })).toBe("data:image/jpeg;base64,AAAA");
  });

  it("keeps PNG for a PNG render", () => {
    expect(thumbnailDataUrl({ ...BASE, format: "png" })).toBe("data:image/png;base64,AAAA");
  });

  it("treats an answer without a format as PNG, as older engines send", () => {
    expect(thumbnailDataUrl(BASE)).toBe("data:image/png;base64,AAAA");
  });
});
