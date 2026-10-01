import { describe, expect, it } from "vitest";
import { MAX_AUTHOR_LENGTH } from "@/shared/store/preferencesStore";
import { DEFAULT_ANNOTATION_AUTHOR, annotationAuthorName } from "./annotationAuthor";

describe("annotationAuthorName", () => {
  it("uses the name from the settings with spaces tidied", () => {
    expect(annotationAuthorName("  Ayşe   Yılmaz ")).toBe("Ayşe Yılmaz");
  });

  it("falls back to the app name when the setting is empty", () => {
    expect(annotationAuthorName("")).toBe(DEFAULT_ANNOTATION_AUTHOR);
    expect(annotationAuthorName(" \t\n ")).toBe(DEFAULT_ANNOTATION_AUTHOR);
  });

  it("cuts names that are too long", () => {
    expect(annotationAuthorName("a".repeat(MAX_AUTHOR_LENGTH + 50))).toHaveLength(MAX_AUTHOR_LENGTH);
  });
});
