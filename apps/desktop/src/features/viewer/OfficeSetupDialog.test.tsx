import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useBundledOfficeStore } from "@/shared/session/bundledOffice";
import { useOpenStore } from "@/shared/store/openStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { axeViolations } from "@/test/axe";

const rpc = vi.hoisted(() => ({ officeStatus: vi.fn(), officeInstall: vi.fn(), officeRemove: vi.fn() }));
vi.mock("@/shared/rpc/office", () => rpc);
const opener = vi.hoisted(() => ({
  openPaths: vi.fn<(paths: string[]) => Promise<void>>(() => Promise.resolve()),
  resumeWaiting: vi.fn(),
}));
vi.mock("./useOpenPdf", () => ({ useOpenPdf: () => opener }));

const { OfficeSetupDialog } = await import("./OfficeSetupDialog");

const DECK = "/Users/me/Desktop/Sunum.pptx";
const STATUS = { installed: false, source: null, path: null, directory: "/data/libreoffice", sizeBytes: 0, supported: true, bundled: false, isolation: null };

function renderDialog() {
  return render(
    <MemoryRouter>
      <OfficeSetupDialog />
    </MemoryRouter>,
  );
}

describe("OfficeSetupDialog", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    rpc.officeStatus.mockReset();
    rpc.officeInstall.mockReset();
    opener.openPaths.mockClear();
    opener.resumeWaiting.mockClear();
    useBundledOfficeStore.setState({ running: false });
    usePreferencesStore.setState({ offlineMode: false });
    useOpenStore.setState({ officeRequest: DECK, waitingPaths: [] });
  });

  afterEach(cleanup);

  it("sets LibreOffice up and then opens the file that asked for it", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    rpc.officeInstall.mockResolvedValue({ ...STATUS, installed: true, source: "managed" });
    const { container } = renderDialog();

    expect(screen.getByText(/To open Sunum\.pptx/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));

    await waitFor(() => expect(opener.openPaths).toHaveBeenCalledWith([DECK]));
    expect(useOpenStore.getState().officeRequest).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps the download off while vivePDF is offline", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    usePreferencesStore.setState({ offlineMode: true });
    renderDialog();

    const install = await screen.findByRole("button", { name: "Download and install" });

    expect((install as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("offline-notice")).toBeTruthy();
  });

  it("shows a failed download and lets it be tried again", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    rpc.officeInstall.mockRejectedValueOnce(new RpcCallError({ code: "NETWORK", message: "offline" }));
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(opener.openPaths).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Download and install" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancelling stops the download and goes on with the other files", async () => {
    rpc.officeStatus.mockResolvedValue(STATUS);
    let signal: AbortSignal | undefined;
    rpc.officeInstall.mockImplementation((options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Download and install" }));

    act(() => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));

    expect(signal?.aborted).toBe(true);
    expect(useOpenStore.getState().officeRequest).toBeNull();
    expect(opener.resumeWaiting).toHaveBeenCalledTimes(1);
    expect(opener.openPaths).not.toHaveBeenCalled();
  });
});
