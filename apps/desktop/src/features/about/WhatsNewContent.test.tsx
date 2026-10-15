import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { notesUpTo, RELEASE_NOTES, releaseKey } from "./releaseNotes";
import { WhatsNewContent } from "./WhatsNewContent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const renderFor = (version: string) =>
  render(
    <MemoryRouter>
      <WhatsNewContent version={version} />
    </MemoryRouter>,
  );

describe("what's new", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(cleanup);

  it("lists the installed version first and hides versions that are not installed yet", () => {
    renderFor("0.2.0");

    const sections = screen.getAllByRole("region");
    expect(sections[0].getAttribute("aria-label")).toBe("Version 0.2.0");
    expect(sections[0].textContent).toContain("Installed");
    expect(sections.map((section) => section.getAttribute("aria-label"))).not.toContain("Version 0.3.0");
    expect(document.body.textContent).not.toMatch(/whatsNew\./);
  });

  it("shows an empty state with an update check when the version has no notes", () => {
    renderFor("0.0.9");

    expect(screen.getByText("No notes for this version yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
  });

  it("keeps every release's items in order and names them by version", () => {
    expect(releaseKey("0.2.0")).toBe("v0_2_0");
    expect(notesUpTo("9.9.9").map((note) => note.version)).toEqual(RELEASE_NOTES.map((note) => note.version));
  });
});
