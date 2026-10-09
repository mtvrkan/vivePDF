import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useReportStore } from "@/shared/store/reportStore";
import { useToastStore } from "@/shared/store/toastStore";
import { ReportDialog } from "./ReportDialog";

const tauri = vi.hoisted(() => ({ openUrl: vi.fn(), save: vi.fn(), invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: tauri.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const diagnostics = { os: "windows", osVersion: "Windows 11 Pro 24H2 build 26100.1", arch: "x86_64", appVersion: "0.2.0", logPath: "~/vivepdf.log", logTail: "line one" };
const writeText = vi.fn();
const lastToast = () => useToastStore.getState().toasts.at(-1);

describe("report dialog", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeText.mockReset().mockResolvedValue(undefined);
    tauri.openUrl.mockReset().mockResolvedValue(undefined);
    tauri.save.mockReset();
    tauri.invoke.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
    useReportStore.getState().openDialog({ category: "idea" });
    useReportStore.setState({ description: "Dark mode is too bright", includeDiagnostics: true, diagnostics });
  });

  afterEach(() => {
    cleanup();
    useReportStore.getState().close();
  });

  it("copies the report with the real OS version and the app language and says it was copied", async () => {
    render(<ReportDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(lastToast()?.message).toBe("Report copied to the clipboard"));
    const body = writeText.mock.calls[0][0] as string;
    expect(body).toContain("OS: Windows 11 Pro 24H2 build 26100.1");
    expect(body).toMatch(/Locale: en \(system .+\)/);
    expect(body).not.toContain("n/a");
  });

  it("marks the chosen report type as pressed", () => {
    render(<ReportDialog />);

    act(() => fireEvent.click(screen.getByRole("button", { name: "Bug" })));

    expect(screen.getByRole("button", { name: "Bug" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Idea" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("group", { name: "Report type" })).toBeTruthy();
  });

  it("reports a failed save instead of staying silent, and says nothing when the save is cancelled", async () => {
    tauri.save.mockResolvedValueOnce(null);
    render(<ReportDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Save report to file" }));
    await waitFor(() => expect(tauri.save).toHaveBeenCalledTimes(1));
    expect(useToastStore.getState().toasts).toHaveLength(0);

    tauri.save.mockResolvedValueOnce("C:/reports/vivepdf-report.txt");
    tauri.invoke.mockRejectedValueOnce({ code: "PERMISSION_DENIED", message: "denied" });
    fireEvent.click(screen.getByRole("button", { name: "Save report to file" }));

    await waitFor(() => expect(lastToast()?.kind).toBe("error"));
  });
});
