import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import CvStudio from "./CvStudio";
import { emptyExperience, emptyProfile } from "./cvModel";
import { useCvStore } from "./cvStore";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => undefined) }),
}));

vi.mock("./cvRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cvRender")>()),
  renderCv: () => new Promise(() => undefined),
}));

const section = (key: string) => document.querySelector(`[data-cv-section="${key}"]`) as HTMLElement;
const educationHeader = () => within(section("education")).getAllByRole("button", { name: /^Education/ })[0];

describe("cv studio tabs", () => {
  beforeAll(async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    localStorage.clear();
    useCvStore.setState({ loaded: false });
    useCvStore.getState().open("en");
    useCvStore.getState().replace({ profile: { ...emptyProfile(), experience: [{ ...emptyExperience(), role: "Designer" }] }, theme: useCvStore.getState().theme });
  });

  afterEach(() => {
    cleanup();
    useCvStore.getState().close();
  });

  it("keeps opened sections and the scroll position of the content tab across a visit to the design tab", () => {
    render(
      <MemoryRouter>
        <CvStudio />
      </MemoryRouter>,
    );
    const content = document.getElementById("cv-panel-content") as HTMLElement;
    const design = document.getElementById("cv-panel-design") as HTMLElement;
    expect(design.childElementCount).toBe(0);

    fireEvent.click(educationHeader());
    const opened = educationHeader().getAttribute("aria-expanded");
    content.scrollTop = 240;

    fireEvent.click(screen.getByRole("tab", { name: "Design" }));
    expect(content.hidden).toBe(true);
    expect(design.hidden).toBe(false);
    expect(design.childElementCount).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Content" }));
    expect(content.hidden).toBe(false);
    expect(design.hidden).toBe(true);
    expect(design.childElementCount).toBeGreaterThan(0);
    expect(educationHeader().getAttribute("aria-expanded")).toBe(opened);
    expect(opened).toBe("true");
    expect(content.scrollTop).toBe(240);
  });
});
