import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useBundledOfficeStore } from "@/shared/session/bundledOffice";
import { axeViolations } from "@/test/axe";

const rpc = vi.hoisted(() => ({ officeStatus: vi.fn(), officeInstall: vi.fn(), officeRemove: vi.fn() }));
vi.mock("@/shared/rpc/office", () => rpc);

const { OfficeManager } = await import("./OfficeManager");

const STATUS = { installed: false, source: null, path: null, directory: "C:/vivePDF/libreoffice", sizeBytes: 0, supported: true, bundled: true, isolation: null };

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  rpc.officeStatus.mockReset();
  rpc.officeInstall.mockReset();
  useBundledOfficeStore.setState({ running: false });
});

afterEach(cleanup);

describe("OfficeManager", () => {
  it("offers an offline install when LibreOffice came with the app", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    const { container } = render(<OfficeManager />);

    expect(await screen.findByRole("button", { name: "Install from the app package" })).toBeTruthy();
    expect(screen.getByText(/installs without internet/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the background setup as an install in progress", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    useBundledOfficeStore.setState({ running: true });
    render(<OfficeManager />);

    const button = await screen.findByRole("button", { name: "Installing…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("keeps the download wording without a bundled installer and shows install errors", async () => {
    rpc.officeStatus.mockResolvedValue({ ...STATUS, bundled: false });
    rpc.officeInstall.mockRejectedValue(new RpcCallError({ code: "NETWORK", message: "offline" }));
    render(<OfficeManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));

    expect(await screen.findByText(/internet|network|connection/i)).toBeTruthy();
  });

  it("says when an installed LibreOffice runs without the system sandbox", async () => {
    rpc.officeStatus.mockResolvedValue({ ...STATUS, installed: true, source: "system", path: "/usr/bin/soffice", isolation: "none" });
    render(<OfficeManager />);

    expect(await screen.findByText(/runs without the system sandbox/)).toBeTruthy();
  });

  it("stays quiet about the sandbox where the system offers none or it is in use", async () => {
    rpc.officeStatus.mockResolvedValue({ ...STATUS, installed: true, source: "system", path: "/usr/bin/soffice", isolation: "landlock" });
    render(<OfficeManager />);

    expect(await screen.findByText("/usr/bin/soffice")).toBeTruthy();
    expect(screen.queryByText(/system sandbox/)).toBeNull();
  });
});
