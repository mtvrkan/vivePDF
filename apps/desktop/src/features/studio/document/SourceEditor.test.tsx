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

describe("SourceEditor other fields", () => {
  it("shows fields the form has no slot for and edits, adds and removes them", () => {
    const changes: SourceDraft[] = [];
    const draft = { ...DRAFT, fields: { ...DRAFT.fields, abstract: "Long text", issn: "1234-5678" } };
    render(<SourceEditor draft={draft} problem={null} onChange={(next) => changes.push(next)} language="en-US" />);

    fireEvent.change(screen.getByLabelText("issn"), { target: { value: "8765-4321" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove the abstract field" }));
    fireEvent.change(screen.getByTestId("cite-new-field"), { target: { value: "Keywords" } });
    fireEvent.keyDown(screen.getByTestId("cite-new-field"), { key: "Enter" });

    expect(changes[0].fields.issn).toBe("8765-4321");
    expect(changes[1].fields).not.toHaveProperty("abstract");
    expect(changes[2].fields).toMatchObject({ abstract: "Long text", keywords: "" });
  });

  it("refuses a field name the form already shows", () => {
    render(<SourceEditor draft={DRAFT} problem={null} onChange={() => undefined} language="en-US" />);

    fireEvent.change(screen.getByTestId("cite-new-field"), { target: { value: "journal" } });

    expect((screen.getByTestId("cite-add-field") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cite-new-field").getAttribute("aria-invalid")).toBe("true");
  });
});
