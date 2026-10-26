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

const step = (key: string) => document.querySelector(`[data-cv-step="${key}"]`) as HTMLElement;
const shownSection = () => document.querySelector("#cv-panel-content [data-cv-section]")?.getAttribute("data-cv-section");

const renderStudio = () =>
  render(
    <MemoryRouter>
      <CvStudio />
    </MemoryRouter>,
  );

describe("cv studio steps", () => {
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

  it("shows one section per step and walks them with the next and previous buttons", () => {
    renderStudio();
    expect(shownSection()).toBe("personal");
    expect(step("personal").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByTestId("cv-step-next"));

    const first = useCvStore.getState().profile.order[0];
    expect(shownSection()).toBe(first);
    expect(step(first).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("cv-step-previous"));
    expect(shownSection()).toBe("personal");
    expect(screen.queryByTestId("cv-step-previous")).toBeNull();
  });

  it("marks a filled section, counts its entries and flags a hidden one", () => {
    useCvStore.getState().updateProfile((profile) => ({ ...profile, hidden: [...profile.hidden, "education"] }));
    renderStudio();

    const experience = step("experience");

    expect(within(experience).getByText("filled in")).toBeTruthy();
    expect(within(experience).getByText("1")).toBeTruthy();
    expect(within(step("education")).getByLabelText("hidden in the CV")).toBeTruthy();
    expect(within(step("education")).queryByText("filled in")).toBeNull();
  });

  it("mounts the design panel on the first visit and keeps it while moving between steps with the arrow keys", () => {
    renderStudio();
    const design = document.getElementById("cv-panel-design") as HTMLElement;
    expect(design.childElementCount).toBe(0);

    fireEvent.click(step("design"));
    expect(design.hidden).toBe(false);
    expect(design.childElementCount).toBeGreaterThan(0);
    expect(document.getElementById("cv-panel-content")).toBeNull();
    expect(screen.queryByTestId("cv-step-next")).toBeNull();

    fireEvent.keyDown(step("design"), { key: "Home" });

    expect(design.hidden).toBe(true);
    expect(design.childElementCount).toBeGreaterThan(0);
    expect(shownSection()).toBe("personal");
    expect(document.activeElement).toBe(step("personal"));
    fireEvent.keyDown(step("personal"), { key: "ArrowUp" });
    expect(step("design").getAttribute("aria-selected")).toBe("true");
  });
});
