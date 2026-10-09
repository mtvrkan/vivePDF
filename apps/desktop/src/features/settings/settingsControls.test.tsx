import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { SectionCard, SettingRow, ThemeCards } from "./settingsControls";
import { SECTION_GROUPS, SECTION_IDS, SECTION_TONES } from "./settingsShared";

describe("settings controls", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(cleanup);

  it("gives every section its group colour and puts the rows on one card under the heading", () => {
    render(
      <SectionCard id="viewer" query="" onEmptyChange={vi.fn()}>
        <SettingRow label="Page gap">
          <span />
        </SettingRow>
      </SectionCard>,
    );

    const section = screen.getByRole("heading", { name: "Viewer" }).closest("section");
    expect(section?.dataset.tone).toBe("improve");
    expect(screen.getByText("Page gap").closest(".glass")?.parentElement).toBe(section);
    for (const id of SECTION_IDS) expect(SECTION_GROUPS.find((group) => (group.sections as readonly string[]).includes(id))?.tone).toBe(SECTION_TONES[id]);
  });

  it("lays tile sections straight on the page without a card around them", () => {
    render(
      <SectionCard id="data" query="" onEmptyChange={vi.fn()} plain>
        <div data-setting-row>tile</div>
      </SectionCard>,
    );

    expect(screen.getByText("tile").closest(".glass")).toBeNull();
  });

  it("hides the section and reports it empty when no row matches the search", () => {
    const onEmptyChange = vi.fn();

    render(
      <SectionCard id="viewer" query="zzz-nothing" onEmptyChange={onEmptyChange}>
        <SettingRow label="Page gap">
          <span />
        </SettingRow>
      </SectionCard>,
    );

    expect(onEmptyChange).toHaveBeenLastCalledWith("viewer", true);
    expect(document.querySelector("[data-settings-section='viewer']")?.hasAttribute("hidden")).toBe(true);
  });

  it("draws the theme previews from the real light and dark tokens", () => {
    render(<ThemeCards value="system" onChange={vi.fn()} ariaLabel="Theme" />);

    const radios = screen.getAllByRole("radio");
    expect(radios[0].querySelector(".theme-light")).not.toBeNull();
    expect(radios[1].querySelector(".dark")).not.toBeNull();
    expect(radios[2].querySelector(".theme-light") && radios[2].querySelector(".dark")).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/hsl\(/);
  });
});
