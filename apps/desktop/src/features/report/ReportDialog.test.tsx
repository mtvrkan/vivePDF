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

  it("previews every log line the report will carry, not only the last few", async () => {
    const logTail = Array.from({ length: 60 }, (_, index) => `entry ${index + 1}`).join("\n");
    tauri.invoke.mockResolvedValue({ ...diagnostics, logTail });
    useReportStore.setState({ diagnostics: { ...diagnostics, logTail } });
    render(<ReportDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const preview = document.querySelector("details pre")?.textContent ?? "";
    expect(preview).toContain("entry 1\n");
    expect(writeText.mock.calls[0][0]).toContain("entry 1\n");
  });

  it("keeps the GitHub link short enough to open by dropping log lines first", async () => {
    const logTail = Array.from({ length: 200 }, (_, index) => `ğüşıöç ${index} ${"ç".repeat(40)}`).join("\n");
    tauri.invoke.mockResolvedValue({ ...diagnostics, logTail });
    useReportStore.setState({ diagnostics: { ...diagnostics, logTail }, description: "Çıktı bozuk geliyor" });
    render(<ReportDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));

    await waitFor(() => expect(tauri.openUrl).toHaveBeenCalledTimes(1));
    const url = tauri.openUrl.mock.calls[0][0] as string;
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(decodeURIComponent(url)).toContain("Çıktı bozuk geliyor");
    expect(decodeURIComponent(url)).toContain("App version: 0.2.0");
  });

  it("says when diagnostics could not be loaded and loads them again on retry", async () => {
    useReportStore.setState({ diagnostics: null, diagnosticsFailed: false, loadingDiagnostics: false });
    let attempts = 0;
    tauri.invoke.mockImplementation((command: string) => {
      if (command !== "diagnostics_info") return Promise.resolve(undefined);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("no log")) : Promise.resolve(diagnostics);
    });
    render(<ReportDialog />);
    fireEvent.click(screen.getByText("What will be included"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Diagnostic details couldn't be loaded"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(document.querySelector("details pre")?.textContent ?? "").toContain("line one"));
    expect(attempts).toBe(2);
  });
});
