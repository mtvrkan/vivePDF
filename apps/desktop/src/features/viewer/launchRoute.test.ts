import { describe, expect, it } from "vitest";
import { routeForLaunch } from "./launchRoute";

describe("routeForLaunch", () => {
  it("names the tab of a tool that has several, so a second launch lands on the right one", () => {
    expect(routeForLaunch("scan", "C:/docs/a.pdf")).toBe("/tools/scan?tab=enhance");
    expect(routeForLaunch("security", "C:/docs/a.pdf")).toBe("/tools/security?tab=encrypt");
    expect(routeForLaunch("privacy", "C:/docs/a.pdf")).toBe("/tools/security?tab=privacy");
  });

  it("sends a picture and a document down different sides of the converter", () => {
    expect(routeForLaunch("topdf", "C:/photos/a.JPG")).toBe("/tools/convert?mode=images-to-pdf");
    expect(routeForLaunch("topdf", "C:/docs/a.docx")).toBe("/tools/convert?mode=file-to-pdf");
    expect(routeForLaunch("topdf", undefined)).toBe("/tools/convert?mode=file-to-pdf");
  });

  it("keeps every shell menu entry pointing somewhere", () => {
    for (const tool of ["merge", "compress", "ocr", "docx", "security", "privacy", "rename", "batch", "topdf"]) {
      expect(routeForLaunch(tool, "C:/docs/a.pdf")).not.toBeNull();
    }
  });

  it("leaves an unknown tool to the plain open path", () => {
    expect(routeForLaunch("nonesuch", "C:/docs/a.pdf")).toBeNull();
  });
});
