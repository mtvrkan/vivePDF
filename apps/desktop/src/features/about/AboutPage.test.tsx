import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { AboutPage } from "./AboutPage";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.0") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AboutPage />
    </MemoryRouter>,
  );

describe("about page", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    tauri.invoke.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("lists the page organizer's own shortcuts, gestures included", () => {
    renderAt("/about?tab=shortcuts");

    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Invert selection")).toBeTruthy();
    expect(within(dialog).getByText("Next / previous search result")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\{\w+\}/);
  });

  it("names every place the app reaches the network, the leaked-password check included", () => {
    renderAt("/about?tab=privacy");

    const dialog = screen.getByRole("dialog");

    expect(dialog.textContent).toContain("api.pwnedpasswords.com");
    expect(dialog.textContent).toContain("api.crossref.org");
    expect(dialog.textContent).not.toContain("The one exception");
  });

  it("opens the log folder from the log file row instead of the data settings", () => {
    renderAt("/about?tab=privacy");

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Open log folder" }));

    expect(tauri.invoke).toHaveBeenCalledWith("open_log_dir");
  });
});
