import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { SourceEditor } from "./SourceEditor";
import type { SourceDraft } from "./sourceDraft";

const DRAFT: SourceDraft = { type: "article", key: "ioannidis2005", authors: "Ioannidis, John", editors: "", fields: { title: "Why Most Published Research Findings Are False" } };

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("SourceEditor sentence case helper", () => {
  it("warns about a Title Case article title and converts it on request", () => {
    let changed: SourceDraft | null = null;
    render(<SourceEditor draft={DRAFT} problem={null} onChange={(draft) => (changed = draft)} sentenceTitles language="en-US" />);

    fireEvent.click(screen.getByTestId("cite-sentence-case"));

    expect(screen.getByTestId("cite-title-case")).toBeTruthy();
    expect((changed as SourceDraft | null)?.fields.title).toBe("Why most published research findings are false");
  });

  it("stays quiet for a style that keeps titles as written", () => {
    render(<SourceEditor draft={DRAFT} problem={null} onChange={() => undefined} language="en-US" />);

    expect(screen.queryByTestId("cite-title-case")).toBeNull();
  });

  it("stays quiet for a book title", () => {
    render(<SourceEditor draft={{ ...DRAFT, type: "book" }} problem={null} onChange={() => undefined} sentenceTitles language="en-US" />);

    expect(screen.queryByTestId("cite-title-case")).toBeNull();
  });
});
