import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";

const rpc = vi.hoisted(() => ({ officeStatus: vi.fn(), officeInstall: vi.fn(), officeRemove: vi.fn() }));
vi.mock("@/shared/rpc/office", () => rpc);
vi.mock("@/shared/store/toolsStatusStore", () => ({ useToolsStatusStore: { getState: () => ({ refresh: async () => undefined }) } }));

const { prepareBundledOffice, useBundledOfficeStore } = await import("./bundledOffice");

const STATUS = { installed: false, source: null, path: null, directory: "C:/vivePDF/libreoffice", sizeBytes: 0, supported: true, bundled: true, isolation: null };

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  localStorage.clear();
  rpc.officeStatus.mockReset();
  rpc.officeInstall.mockReset();
  useToastStore.setState({ toasts: [], held: false });
  useBundledOfficeStore.setState({ running: false });
});

describe("prepareBundledOffice", () => {
  it("installs the bundled LibreOffice once and never tries again", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    rpc.officeInstall.mockResolvedValue({ ...STATUS, installed: true, source: "managed" });

    const first = await prepareBundledOffice();
    const second = await prepareBundledOffice();

    expect([first, second]).toEqual([true, false]);
    expect(rpc.officeInstall).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(["LibreOffice is ready for Office conversions."]);
    expect(useBundledOfficeStore.getState().running).toBe(false);
  });

  it("leaves an existing LibreOffice and a package without one alone", async () => {
    rpc.officeStatus.mockResolvedValueOnce({ ...STATUS, installed: true, source: "system" }).mockResolvedValueOnce({ ...STATUS, bundled: false });

    expect(await prepareBundledOffice()).toBe(false);
    expect(await prepareBundledOffice()).toBe(false);
    expect(rpc.officeInstall).not.toHaveBeenCalled();
  });

  it("reports a failed setup and does not retry it on the next start", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    rpc.officeInstall.mockRejectedValue(new RpcCallError({ code: "EXTERNAL_TOOL_FAILED", message: "msiexec exited with 1603" }));

    expect(await prepareBundledOffice()).toBe(false);
    expect(await prepareBundledOffice()).toBe(false);

    expect(rpc.officeInstall).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts[0]?.kind).toBe("error");
    expect(useBundledOfficeStore.getState().running).toBe(false);
  });
});
