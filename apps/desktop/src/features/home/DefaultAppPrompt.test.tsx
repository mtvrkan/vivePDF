import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import type { DefaultAppStatus } from "@/types";

const defaultPdfAppStatus = vi.fn<() => Promise<DefaultAppStatus>>();
const makeDefaultPdfApp = vi.fn<(name: string, description: string) => Promise<"done" | "settings">>();

vi.mock("@/shared/rpc/files", () => ({
  defaultPdfAppStatus: () => defaultPdfAppStatus(),
  makeDefaultPdfApp: (name: string, description: string) => makeDefaultPdfApp(name, description),
}));

const { DefaultAppPrompt, DEFAULT_APP_PROMPT_KEY } = await import("./DefaultAppPrompt");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  defaultPdfAppStatus.mockReset();
  makeDefaultPdfApp.mockReset();
});

afterEach(cleanup);

async function renderPrompt() {
  await act(async () => {
    render(<DefaultAppPrompt />);
  });
}

describe("DefaultAppPrompt", () => {
  it("names the current app and makes vivePDF the default", async () => {
    defaultPdfAppStatus.mockResolvedValueOnce({ supported: true, isDefault: false, current: "Preview" }).mockResolvedValue({ supported: true, isDefault: true, current: "vivePDF" });
    makeDefaultPdfApp.mockResolvedValue("done");
    await renderPrompt();

    expect(screen.getByText("PDF files you double-click open in Preview.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    });

    expect(makeDefaultPdfApp).toHaveBeenCalledWith("vivePDF", expect.any(String));
    expect(screen.queryByRole("button", { name: "Make default" })).toBeNull();
  });

  it("stays hidden when vivePDF is already the default or the platform can't tell", async () => {
    defaultPdfAppStatus.mockResolvedValue({ supported: true, isDefault: true, current: "vivePDF" });
    await renderPrompt();
    expect(screen.queryByText("vivePDF is not your default PDF app")).toBeNull();
    cleanup();

    defaultPdfAppStatus.mockResolvedValue({ supported: false, isDefault: false, current: null });
    await renderPrompt();
    expect(screen.queryByText("vivePDF is not your default PDF app")).toBeNull();
  });

  it("remembers \"Don't ask again\" and keeps quiet afterwards", async () => {
    defaultPdfAppStatus.mockResolvedValue({ supported: true, isDefault: false, current: null });
    await renderPrompt();

    expect(screen.getByText("PDF files you double-click don’t open in vivePDF.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don’t ask again" }));

    expect(screen.queryByText("vivePDF is not your default PDF app")).toBeNull();
    expect(localStorage.getItem(DEFAULT_APP_PROMPT_KEY)).toBe("1");
    cleanup();
    await renderPrompt();
    expect(screen.queryByText("vivePDF is not your default PDF app")).toBeNull();
  });

  it("shows the error and keeps the card when making the default fails", async () => {
    defaultPdfAppStatus.mockResolvedValue({ supported: true, isDefault: false, current: "Preview" });
    makeDefaultPdfApp.mockRejectedValue({ code: "UNSUPPORTED", message: "nope" });
    await renderPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    });

    expect(screen.getByRole("button", { name: "Make default" })).toBeTruthy();
    expect(useToastStore.getState().toasts.map((toast) => toast.kind)).toEqual(["error"]);
  });

  it("stays silent when the user cancels the system confirmation", async () => {
    defaultPdfAppStatus.mockResolvedValue({ supported: true, isDefault: false, current: "Preview" });
    makeDefaultPdfApp.mockRejectedValue({ code: "CANCELLED", message: "cancelled" });
    await renderPrompt();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    });

    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
