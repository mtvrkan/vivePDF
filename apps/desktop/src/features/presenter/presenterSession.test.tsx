import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitImmersive } from "@/features/viewer/immersive";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { useUiStore } from "@/shared/store/uiStore";
import { endPresenter, startPresenter, usePresenterStore } from "./presenterSession";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));

vi.mock("@tauri-apps/api/window", () => {
  const appWindow = {
    isMaximized: async () => false,
    outerPosition: async () => ({ x: 0, y: 0 }),
    innerSize: async () => ({ width: 800, height: 600 }),
    unmaximize: async () => {},
    maximize: async () => {},
    setFullscreen: async () => {},
    setPosition: async () => {},
    setSize: async () => {},
    setAlwaysOnTop: async () => {},
    label: "main",
  };
  return { getCurrentWindow: () => appWindow, currentMonitor: async () => null, PhysicalPosition: class {}, PhysicalSize: class {} };
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useDocumentStore.getState().register("doc-a", "C:/talks/deck.pdf", null);
  usePresentationStore.setState({ drawingsMode: "annotations" });
  localStorage.setItem("vivepdf.presentation", JSON.stringify({ drawingsMode: "annotations" }));
});

afterEach(() => {
  endPresenter();
  useUiStore.getState().setImmersive(false);
  localStorage.clear();
});

describe("presenterSession", () => {
  it("opens the audience, keeps drawings temporary and rehearses in the window on one screen", async () => {
    invoke.mockResolvedValueOnce({ label: "present-a", external: false, width: 1280, height: 720 });

    await startPresenter("doc-a", 7);

    expect(invoke).toHaveBeenCalledWith("presenter_open", { path: "C:/talks/deck.pdf", password: null, startPage: 6 });
    expect(usePresenterStore.getState().session).toMatchObject({ documentId: "doc-a", audience: "present-a", external: false, lost: false });
    expect(usePresenterStore.getState().session?.aspect).toBeCloseTo(16 / 9);
    expect(usePresentationStore.getState().drawingsMode).toBe("temporary");
    expect(useUiStore.getState()).toMatchObject({ immersive: true, immersiveStartPage: 7 });
  });

  it("closes the audience and restores the drawing setting when the presentation ends", async () => {
    invoke.mockResolvedValueOnce({ label: "present-a", external: false, width: 0, height: 0 });
    await startPresenter("doc-a", 1);
    invoke.mockResolvedValue(undefined);

    await exitImmersive();

    expect(usePresenterStore.getState().session).toBeNull();
    expect(usePresentationStore.getState().drawingsMode).toBe("annotations");
    expect(invoke).toHaveBeenCalledWith("presenter_close");
  });

  it("stays out of presenter mode when the audience window cannot open", async () => {
    invoke.mockRejectedValueOnce({ code: "PERMISSION_DENIED", message: "not granted" });

    await expect(startPresenter("doc-a", 1)).rejects.toThrow();

    expect(usePresenterStore.getState().session).toBeNull();
    expect(useUiStore.getState().immersive).toBe(false);
    expect(usePresentationStore.getState().drawingsMode).toBe("annotations");
  });
});
