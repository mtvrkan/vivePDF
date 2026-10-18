import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { saveSupportBundle, supportBundleParams, supportErrorMessage, supportFileName } from "./supportBundle";

const tauri = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: tauri.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const DIAGNOSTICS = { os: "windows", osVersion: "Windows 11", arch: "x86_64", appVersion: "0.2.0", logPath: "~/log", logTail: "tail line" };
const SOURCES = { diagnostics: DIAGNOSTICS, logs: { current: "now", previous: "" }, environment: ["Engine: 1"], locale: "en" };

function rpcCalls() {
  return tauri.invoke.mock.calls.filter(([command]) => command === "rpc");
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  tauri.save.mockReset();
  tauri.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "diagnostics_info") return DIAGNOSTICS;
    if (command === "support_logs") return { current: "log now", previous: "log before" };
    if (command === "rpc") return { output: "C:/out/support.zip", bytes: 10, files: 4 };
    return null;
  });
  useToastStore.setState({ toasts: [] });
  usePreferencesStore.setState({ successToasts: true });
});

describe("supportBundleParams", () => {
  it("puts the report, the diagnostics without the log tail and the logs in the bundle", () => {
    const params = supportBundleParams("C:/out/s.zip", { report: "It broke", attachments: ["C:/a.pdf"] }, SOURCES);

    expect(params.texts?.map((entry) => [entry.folder ?? "", entry.name])).toEqual([
      ["", "report.txt"],
      ["", "diagnostics.txt"],
      ["logs", "vivepdf.log"],
    ]);
    expect(params.texts?.[1].text).toContain("App version: 0.2.0");
    expect(params.texts?.[1].text).not.toContain("tail line");
    expect(params).toMatchObject({ output: "C:/out/s.zip", attachments: ["C:/a.pdf"], images: [], overwrite: true });
  });

  it("skips an empty report and still writes the environment when diagnostics are missing", () => {
    const params = supportBundleParams("C:/out/s.zip", { report: "   " }, { ...SOURCES, diagnostics: null, logs: null });

    expect(params.texts).toEqual([{ name: "diagnostics.txt", text: "Engine: 1\nLocale: en" }]);
  });

  it("names the file after the day", () => {
    expect(supportFileName(new Date(2026, 9, 5))).toBe("vivepdf-support-2026-10-05.zip");
  });
});

describe("saveSupportBundle", () => {
  it("asks where to save, builds the bundle and offers to show it", async () => {
    tauri.save.mockResolvedValueOnce("C:/out/support.zip");

    const output = await saveSupportBundle();

    expect(output).toBe("C:/out/support.zip");
    const [, payload] = rpcCalls()[0];
    expect(payload).toMatchObject({ method: "system.support_bundle" });
    expect(JSON.stringify(payload)).toContain("log before");
    const [toast] = useToastStore.getState().toasts;
    expect(toast).toMatchObject({ kind: "success", message: "Support bundle saved", action: { label: "Show in folder" } });
    toast.action?.onClick();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("reveal_path", { path: "C:/out/support.zip" }));
  });

  it("does nothing when the save dialog is cancelled", async () => {
    tauri.save.mockResolvedValueOnce(null);

    expect(await saveSupportBundle()).toBeNull();
    expect(rpcCalls()).toEqual([]);
  });

  it("explains a refused bundle", async () => {
    tauri.save.mockResolvedValueOnce("C:/out/support.zip");
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "rpc") throw { code: "INVALID_PARAMS", message: "too large", data: { reason: "tooLarge", limitMb: 50 } };
      return null;
    });

    expect(await saveSupportBundle()).toBeNull();
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: "error", message: "These files are too big for a support bundle (limit 50 MB)." });
    expect(supportErrorMessage({ code: "INVALID_PARAMS", message: "x", data: { reason: "badImage" } })).toBe("Only PNG or JPEG pictures can be added.");
  });
});
