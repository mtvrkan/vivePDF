import { describe, expect, it } from "vitest";
import { isPhotoPath } from "./photoFiles";

describe("isPhotoPath", () => {
  it("accepts the picture types the engine can decode, in any letter case", () => {
    expect(isPhotoPath("C:\\Belgeler\\fiş ğüı.JPG")).toBe(true);
    expect(isPhotoPath("/home/me/tarama çıktısı.tiff")).toBe(true);
    expect(isPhotoPath("scan.webp")).toBe(true);
  });

  it("accepts iPhone HEIC and HEIF pictures now that the engine decodes them", () => {
    expect(isPhotoPath("C:\\Photos\\IMG_0001.HEIC")).toBe(true);
    expect(isPhotoPath("/home/me/photo.heif")).toBe(true);
  });

  it("refuses files without an extension and folders with a dot in their name", () => {
    expect(isPhotoPath("C:\\photos.jpg\\readme")).toBe(false);
    expect(isPhotoPath(".jpg")).toBe(false);
    expect(isPhotoPath("document.pdf")).toBe(false);
  });
});
