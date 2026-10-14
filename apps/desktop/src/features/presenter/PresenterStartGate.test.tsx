import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import { endPresenter, usePresenterStore } from "./presenterSession";

const invoke = vi.hoisted(() => vi.fn());
const saving = vi.hoisted(() => ({ unsaved: 0, save: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock("@embedpdf/plugin-scroll/react", () => ({ useScroll: () => ({ state: { currentPage: 4, totalPages: 9 }, provides: null }) }));
vi.mock("@/features/viewer/useDocumentSave", () => ({ useDocumentSave: () => ({ save: saving.save, unsavedCount: () => saving.unsaved }) }));

const { PresenterStartGate } = await import("./PresenterStartGate");

async function request(startPage: number | null) {
  await act(async () => usePresenterStore.getState().requestPresenter("doc-a", startPage));
}

describe("PresenterStartGate", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "presenter_open" ? { label: "present-a", external: false, width: 1280, height: 720 } : null));
    saving.unsaved = 0;
    saving.save.mockReset();
    useToastStore.setState({ toasts: [] });
    useDocumentStore.getState().register("doc-a", "C:/talks/deck.pdf", null);
  });

  afterEach(() => {
    cleanup();
    endPresenter();
    useUiStore.getState().setImmersive(false);
    usePresenterStore.setState({ request: null });
  });

  it("starts from the page on screen when no start page is asked for", async () => {
    render(<PresenterStartGate documentId="doc-a" />);

    await request(null);

    expect(invoke).toHaveBeenCalledWith("presenter_open", { path: "C:/talks/deck.pdf", password: null, startPage: 3 });
    expect(usePresenterStore.getState().request).toBeNull();
  });

  it("warns about unsaved changes and presents the saved file on request", async () => {
    saving.unsaved = 2;
    render(<PresenterStartGate documentId="doc-a" />);

    await request(1);
    expect(screen.getByRole("dialog", { name: "Present the saved file?" })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("presenter_open", expect.anything());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Present anyway" })));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("presenter_open", { path: "C:/talks/deck.pdf", password: null, startPage: 0 });
  });

  it("stays put when saving fails and reports a failed start", async () => {
    saving.unsaved = 1;
    saving.save.mockResolvedValue(false);
    render(<PresenterStartGate documentId="doc-a" />);
    await request(1);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save and present" })));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("presenter_open", expect.anything());

    saving.unsaved = 0;
    invoke.mockRejectedValue({ code: "IO_ERROR", message: "no screen" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await request(2);

    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("error");
  });
});
