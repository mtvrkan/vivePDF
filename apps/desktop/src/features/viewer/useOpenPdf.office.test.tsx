import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useOpenStore } from "@/shared/store/openStore";
import { useToastStore } from "@/shared/store/toastStore";

const conversion = vi.hoisted(() => ({ fileToPdf: vi.fn(), clipboardToPdf: vi.fn() }));
vi.mock("@/shared/rpc/operations", () => conversion);
vi.mock("@tauri-apps/api/path", () => ({ tempDir: () => Promise.resolve("/tmp"), join: (...parts: string[]) => Promise.resolve(parts.join("/")) }));
vi.mock("@embedpdf/plugin-document-manager/react", () => ({ useDocumentManagerCapability: () => ({ provides: { getDocumentCount: () => 0 } }) }));

const { useOpenPdf } = await import("./useOpenPdf");

const DECK = "/Users/me/Desktop/Sunum.pptx";
const SHEET = "/Users/me/Desktop/Tablo.xlsx";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useOpenPdf with an Office file", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    conversion.fileToPdf.mockReset();
    useOpenStore.setState({ officeRequest: null, passwordRequest: null, waitingPaths: [], busy: false });
    useToastStore.setState({ toasts: [] });
  });

  it("asks to set up LibreOffice instead of showing an error when it is missing", async () => {
    conversion.fileToPdf.mockRejectedValue(new RpcCallError({ code: "LIBREOFFICE_MISSING", message: "missing" }));
    const { result } = renderHook(() => useOpenPdf(), { wrapper });

    let opened = true;
    await act(async () => {
      opened = await result.current.openPath(DECK);
    });

    expect(opened).toBe(false);
    expect(useOpenStore.getState().officeRequest).toBe(DECK);
    expect(useToastStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(false);
  });

  it("keeps the error toast for other conversion failures", async () => {
    conversion.fileToPdf.mockRejectedValue(new RpcCallError({ code: "INTERNAL", message: "boom" }));
    const { result } = renderHook(() => useOpenPdf(), { wrapper });

    await act(async () => {
      await result.current.openPath(DECK);
    });

    expect(useOpenStore.getState().officeRequest).toBeNull();
    expect(useToastStore.getState().toasts.some((toast) => toast.kind === "error")).toBe(true);
  });

  it("holds the rest of a multi-file open until the setup question is answered", async () => {
    conversion.fileToPdf.mockRejectedValue(new RpcCallError({ code: "LIBREOFFICE_MISSING", message: "missing" }));
    const { result } = renderHook(() => useOpenPdf(), { wrapper });

    await act(async () => {
      await result.current.openPaths([DECK, SHEET]);
    });

    expect(conversion.fileToPdf).toHaveBeenCalledTimes(1);
    expect(useOpenStore.getState().waitingPaths).toEqual([SHEET]);
  });

  it("lets a sheet without its own paper size fall back to the paper of the user's region", async () => {
    conversion.fileToPdf.mockRejectedValue(new RpcCallError({ code: "INTERNAL", message: "boom" }));
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    const { result } = renderHook(() => useOpenPdf(), { wrapper });

    await act(async () => {
      await result.current.openPath(SHEET);
    });

    expect(conversion.fileToPdf).toHaveBeenCalledWith(expect.objectContaining({ path: SHEET, defaultPaper: "letter" }));
    expect(conversion.fileToPdf.mock.calls[0][0]).not.toHaveProperty("paper");
  });
});
