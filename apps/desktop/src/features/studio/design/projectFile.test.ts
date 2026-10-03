import { beforeEach, describe, expect, it, vi } from "vitest";

const studioOpenProject = vi.fn();
const studioSaveProject = vi.fn();
const saveDialog = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({
  studioOpenProject: (...args: unknown[]) => studioOpenProject(...args),
  studioSaveProject: (...args: unknown[]) => studioSaveProject(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: (...args: unknown[]) => saveDialog(...args) }));
vi.mock("@/shared/lib/paths", async (original) => ({ ...(await original<typeof import("@/shared/lib/paths")>()), defaultOutputDirectory: async () => "C:\\Docs" }));
vi.mock("./measure", () => ({ measureTexts: async () => new Map() }));
vi.mock("@/shared/store/uiStore", () => ({ useUiStore: { getState: () => ({ locale: "en" }) } }));

import { addElements } from "../model/edit";
import { createDesign, createImage } from "../model/design";
import { loadDesign, saveDesign } from "./projectFile";
import { useRecentDesignsStore } from "./recentDesigns";
import { useStudioStore } from "./studioStore";

function poster() {
  const design = createDesign("Poster", 400, 300);
  const page = addElements(design.pages[0], [createImage("C:\\pics\\a.png", 0, 0, 10, 10), createImage("", 0, 0, 10, 10)]);
  return { ...design, pages: [page] };
}

describe("studio project files", () => {
  beforeEach(() => {
    studioOpenProject.mockReset();
    studioSaveProject.mockReset();
    saveDialog.mockReset();
    useRecentDesignsStore.setState({ items: [] });
    useStudioStore.getState().close();
  });

  it("opens a project with its path and remembers it among recent designs", async () => {
    studioOpenProject.mockResolvedValue({ design: poster(), thumbnail: "QUJD", source: "project" });

    const loaded = await loadDesign("C:\\Docs\\poster.vivedesign");

    expect(loaded.filePath).toBe("C:\\Docs\\poster.vivedesign");
    expect(loaded.design.name).toBe("Poster");
    expect(useRecentDesignsStore.getState().items[0]).toMatchObject({ name: "Poster", width: 400, height: 300, thumbnail: "data:image/jpeg;base64,QUJD" });
  });

  it("opens a design from a PDF without a file path so saving asks where to keep it", async () => {
    studioOpenProject.mockResolvedValue({ design: poster(), thumbnail: "", source: "pdf" });

    const loaded = await loadDesign("C:\\Docs\\poster.pdf", "secret");

    expect(studioOpenProject).toHaveBeenCalledWith({ path: "C:\\Docs\\poster.pdf", password: "secret" });
    expect(loaded.filePath).toBeNull();
    expect(useRecentDesignsStore.getState().items).toEqual([]);
  });

  it("refuses data that is not a design", async () => {
    studioOpenProject.mockResolvedValue({ design: { kind: "nope" }, thumbnail: "", source: "project" });

    await expect(loadDesign("C:\\Docs\\bad.vivedesign")).rejects.toMatchObject({ code: "INVALID_PARAMS", data: { reason: "notProject" } });
  });

  it("saves to the known file without asking and sends the pictures and a first-page preview", async () => {
    useStudioStore.getState().open(poster(), "C:\\Docs\\poster.vivedesign");
    useStudioStore.getState().apply((design) => ({ ...design, name: "Poster 2" }));
    studioSaveProject.mockImplementation(async (params: { output: string }) => ({ output: params.output, bytes: 10, thumbnail: "" }));

    const saved = await saveDesign({ saveAs: false, fallbackName: "Untitled", filterName: "Design" });

    expect(saveDialog).not.toHaveBeenCalled();
    expect(saved).toBe("C:\\Docs\\poster.vivedesign");
    const params = studioSaveProject.mock.calls[0][0];
    expect(params.assets).toEqual(["C:\\pics\\a.png"]);
    expect(params.preview.width).toBe(400);
    expect(params.overwrite).toBe(true);
    expect(useStudioStore.getState().dirty).toBe(false);
  });

  it("asks for a file on Save as and does nothing when the dialog is cancelled", async () => {
    useStudioStore.getState().open(poster(), null);
    saveDialog.mockResolvedValue(null);

    const saved = await saveDesign({ saveAs: true, fallbackName: "Untitled", filterName: "Design" });

    expect(saved).toBeNull();
    expect(saveDialog.mock.calls[0][0].defaultPath).toBe("C:\\Docs\\Poster.vivedesign");
    expect(studioSaveProject).not.toHaveBeenCalled();
  });
});
