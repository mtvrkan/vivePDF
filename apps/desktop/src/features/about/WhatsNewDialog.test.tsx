import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { WhatsNewDialog } from "./WhatsNewDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.0") }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

const renderDialog = () =>
  render(
    <MemoryRouter>
      <WhatsNewDialog />
    </MemoryRouter>,
  );

describe("what's new after an update", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => localStorage.clear());

  afterEach(cleanup);

  it("opens once after an upgrade with the installed version's notes", async () => {
    localStorage.setItem("vivepdf.lastSeenVersion", "0.1.1");
    renderDialog();

    expect(await screen.findByRole("dialog", { name: "vivePDF 0.2.0 is installed" })).toBeTruthy();
    cleanup();
    renderDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays shut on a first install", async () => {
    renderDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("vivepdf.lastSeenVersion")).toBe("0.2.0");
  });
});
