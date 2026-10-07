import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useFallbackFontsStore } from "@/shared/store/fallbackFontsStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { axeViolations } from "@/test/axe";

const hooks = vi.hoisted(() => ({ reload: vi.fn(async () => true), unsaved: false }));
const rpc = vi.hoisted(() => ({ fallbackFontsDownload: vi.fn() }));

vi.mock("@/shared/rpc/fallbackFonts", () => rpc);
vi.mock("./useReloadDocument", () => ({ useReloadDocument: () => hooks.reload }));
vi.mock("@embedpdf/plugin-history/react", () => ({
  useHistoryCapability: () => ({ provides: { forDocument: () => ({ canUndo: () => hooks.unsaved }) } }),
}));
vi.mock("./useUnsavedMarks", () => ({ useUnsavedMarks: () => hooks.unsaved }));

const { FallbackFontMessages } = await import("./FallbackFontMessages");

const DOCUMENT_ID = "doc-fonts";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  hooks.reload.mockClear();
  hooks.unsaved = false;
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/yazi.pdf", null);
  useDocumentStore.getState().setActive(DOCUMENT_ID);
  rpc.fallbackFontsDownload.mockReset();
  rpc.fallbackFontsDownload.mockResolvedValue({ set: "ja", bytes: 1 });
  usePendingChangesStore.setState({ changes: {} });
  useFallbackFontsStore.setState({ missing: {}, dismissed: {}, downloads: {} });
});

afterEach(cleanup);

function missing(...sets: string[]) {
  useFallbackFontsStore.setState({ missing: { [DOCUMENT_ID]: sets } });
}

describe("FallbackFontMessages", () => {
  it("renders nothing when the document needs no font", () => {
    const { container } = render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers the missing set with its size and ignores unknown sets", async () => {
    missing("ja", "latin", "unknown");
    const { container } = render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    expect(screen.getByText(/Japanese text in this document needs a font \(4[.,]\d+ MB\)/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("downloads the set and reloads a document without unsaved changes", async () => {
    missing("ja");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(rpc.fallbackFontsDownload).toHaveBeenCalledWith("ja", expect.anything());
    expect(hooks.reload).toHaveBeenCalledTimes(1);
  });

  it("asks for a save instead of reloading when there are unsaved changes", async () => {
    hooks.unsaved = true;
    missing("ko");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(hooks.reload).not.toHaveBeenCalled();
    expect(screen.getByText("The Korean font is ready. Save the document and open it again to show the text.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("keeps the manual reload when marks were added while the font downloaded", async () => {
    let finish: (value: { set: string; bytes: number }) => void = () => undefined;
    rpc.fallbackFontsDownload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    missing("ja");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    hooks.unsaved = true;
    await act(async () => {
      finish({ set: "ja", bytes: 1 });
    });
    expect(hooks.reload).not.toHaveBeenCalled();
  });

  it("keeps the manual reload when another document became active during the download", async () => {
    let finish: (value: { set: string; bytes: number }) => void = () => undefined;
    rpc.fallbackFontsDownload.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    missing("ja");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    useDocumentStore.getState().register("doc-other", "C:/belgeler/baska.pdf", null);
    useDocumentStore.getState().setActive("doc-other");
    await act(async () => {
      finish({ set: "ja", bytes: 1 });
    });
    expect(hooks.reload).not.toHaveBeenCalled();
  });

  it("shows the failure and offers a retry", async () => {
    rpc.fallbackFontsDownload.mockRejectedValue(new RpcCallError({ code: "NETWORK", message: "offline", data: { set: "ja", reason: "fontChecksum" } }));
    missing("ja");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(screen.getByText(/did not match its published checksum/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(hooks.reload).not.toHaveBeenCalled();
  });

  it("hides a dismissed set", () => {
    missing("ja", "ko");
    render(<FallbackFontMessages documentId={DOCUMENT_ID} />);
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Close message" })[0]);
    });
    expect(screen.queryByText(/Japanese text/)).toBeNull();
    expect(screen.getByText(/Korean text/)).toBeTruthy();
  });
});
