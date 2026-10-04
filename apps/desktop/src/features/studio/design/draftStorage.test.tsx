import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { studioLoadDraft, studioSaveDraft } from "@/shared/rpc/operations";
import { createDesign } from "../model/design";

vi.mock("@/shared/rpc/operations", () => ({
  studioSaveDraft: vi.fn(async () => ({ bytes: 10, savedAt: 1 })),
  studioLoadDraft: vi.fn(async () => ({ found: false, design: null, filePath: null, savedAt: 0 })),
}));

async function freshStorage() {
  vi.resetModules();
  return import("./draftStorage");
}

async function toasts() {
  const { useToastStore } = await import("@/shared/store/toastStore");
  return useToastStore.getState().toasts;
}

describe("studio draft storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(studioSaveDraft).mockClear();
    vi.mocked(studioLoadDraft).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("writes only the latest design once the edits pause", async () => {
    const storage = await freshStorage();
    const first = createDesign("First", 100, 100);
    const second = createDesign("Second", 100, 100);

    storage.scheduleDraft(first, null);
    storage.scheduleDraft(second, "C:/designs/card.vivedesign");
    await vi.advanceTimersByTimeAsync(storage.DRAFT_DELAY_MS + 10);

    expect(studioSaveDraft).toHaveBeenCalledTimes(1);
    expect(studioSaveDraft).toHaveBeenCalledWith({ design: second, filePath: "C:/designs/card.vivedesign" });
  });

  it("flushes at once on leave and serves the draft from memory", async () => {
    const storage = await freshStorage();
    const design = createDesign("Leaving", 100, 100);

    storage.scheduleDraft(design, null);
    await storage.flushDraft();
    const loaded = await storage.loadDraft();

    expect(studioSaveDraft).toHaveBeenCalledTimes(1);
    expect(loaded?.design).toBe(design);
    expect(studioLoadDraft).not.toHaveBeenCalled();
  });

  it("loads the draft file after a restart and drops a stale browser copy", async () => {
    const storage = await freshStorage();
    const design = createDesign("From file", 120, 80);
    localStorage.setItem(storage.LEGACY_DRAFT_KEY, JSON.stringify({ design: createDesign("Old", 10, 10), filePath: null }));
    vi.mocked(studioLoadDraft).mockResolvedValueOnce({ found: true, design, filePath: "C:/a.vivedesign", savedAt: 5 });

    const loaded = await storage.loadDraft();

    expect(loaded?.design.name).toBe("From file");
    expect(loaded?.filePath).toBe("C:/a.vivedesign");
    expect(localStorage.getItem(storage.LEGACY_DRAFT_KEY)).toBeNull();
  });

  it("moves an old browser draft into the draft file once", async () => {
    const storage = await freshStorage();
    const legacy = createDesign("Legacy", 200, 100);
    localStorage.setItem(storage.LEGACY_DRAFT_KEY, JSON.stringify({ design: legacy, filePath: "C:/legacy.vivedesign" }));

    const loaded = await storage.loadDraft();

    expect(loaded?.design.name).toBe("Legacy");
    expect(studioSaveDraft).toHaveBeenCalledWith({ design: loaded?.design, filePath: "C:/legacy.vivedesign" });
    expect(localStorage.getItem(storage.LEGACY_DRAFT_KEY)).toBeNull();
  });

  it("keeps the old browser draft when it cannot be moved yet", async () => {
    const storage = await freshStorage();
    localStorage.setItem(storage.LEGACY_DRAFT_KEY, JSON.stringify({ design: createDesign("Legacy", 200, 100), filePath: null }));
    vi.mocked(studioSaveDraft).mockRejectedValueOnce({ code: "INTERNAL", message: "disk full" });

    const loaded = await storage.loadDraft();

    expect(loaded?.design.name).toBe("Legacy");
    expect(localStorage.getItem(storage.LEGACY_DRAFT_KEY)).not.toBeNull();
    expect(await toasts()).toHaveLength(1);
  });

  it("returns nothing when there is no draft anywhere", async () => {
    const storage = await freshStorage();

    expect(await storage.loadDraft()).toBeNull();
  });

  it("warns once instead of sending a design that is too large", async () => {
    const storage = await freshStorage();
    const huge = { ...createDesign("Huge", 100, 100), name: "x".repeat(storage.DRAFT_MAX_BYTES + 1) };

    storage.scheduleDraft(huge, null);
    await storage.flushDraft();
    storage.scheduleDraft({ ...huge }, null);
    await storage.flushDraft();

    expect(studioSaveDraft).not.toHaveBeenCalled();
    const shown = await toasts();
    expect(shown).toHaveLength(1);
    expect(shown[0].kind).toBe("error");
  });

  it("lets a failing load reach the start page", async () => {
    const storage = await freshStorage();
    vi.mocked(studioLoadDraft).mockRejectedValueOnce({ code: "INTERNAL", message: "sidecar stopped" });

    await expect(storage.loadDraft()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
