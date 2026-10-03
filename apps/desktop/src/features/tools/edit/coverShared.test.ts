import { describe, expect, it } from "vitest";
import type { DocumentInfo, SourceDocument } from "@/types";
import { coverDefaults } from "./coverShared";

const source = (metadata: Record<string, string>): SourceDocument => ({ path: "C:/docs/Quarterly report.pdf", fileName: "Quarterly report.pdf", password: null, info: { metadata } as unknown as DocumentInfo });

describe("coverDefaults", () => {
  it("takes the title and author from the document properties", () => {
    expect(coverDefaults(source({ title: " Annual Report ", author: "Ayşe Demir" }))).toEqual({ title: "Annual Report", author: "Ayşe Demir" });
  });

  it("falls back to the file name when the document has no title", () => {
    expect(coverDefaults(source({ title: "  " }))).toEqual({ title: "Quarterly report", author: "" });
  });

  it("leaves both empty without a document", () => {
    expect(coverDefaults(null)).toEqual({ title: "", author: "" });
  });
});
