import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { StatsCard } from "./StatsCard";

vi.mock("@/features/viewer/useOpenPdf", () => ({
  useOpenPdf: () => ({ pickAndOpen: vi.fn(), openPath: vi.fn() }),
}));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

const shortcutKeys = () => Array.from(document.querySelectorAll("kbd")).map((key) => key.textContent);

describe("StatsCard", () => {
  it("lists more shortcuts the larger the card is", () => {
    const { unmount } = render(<StatsCard size="small" />, { wrapper: MemoryRouter });
    expect(shortcutKeys()).toEqual([]);
    unmount();

    const medium = render(<StatsCard size="medium" />, { wrapper: MemoryRouter });
    expect(shortcutKeys()).toEqual(["Ctrl O", "Ctrl K", "Ctrl F", "Ctrl P"]);
    medium.unmount();

    render(<StatsCard size="large" />, { wrapper: MemoryRouter });
    expect(shortcutKeys()).toEqual(["Ctrl O", "Ctrl K", "Ctrl F", "Ctrl P", "Ctrl W", "F11"]);
    expect(screen.getByRole("button", { name: /Close active document/ })).toBeTruthy();
  });
});
