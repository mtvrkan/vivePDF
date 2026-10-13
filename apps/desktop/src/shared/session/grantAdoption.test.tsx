import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@/types";

const invoke = vi.fn();
const mainWindow = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/shared/lib/windowRole", () => ({ isMainWindow: () => mainWindow() }));

const { adoptKnownPaths, knownPaths } = await import("./grantAdoption");

const snapshot: SessionSnapshot = {
  savedAt: 1,
  route: "/pages",
  documents: ["C:/docs/a.pdf", "C:/docs/b.pdf"],
  activePath: "C:/docs/a.pdf",
  organizer: {
    mainPath: "C:/docs/a.pdf",
    tiles: [],
    sources: [{ id: "s", path: "C:/docs/inserted.pdf", fileName: "inserted.pdf", pageCount: 1 }],
    selected: [],
  },
};

describe("grantAdoption", () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    invoke.mockResolvedValue(0);
    mainWindow.mockReturnValue(true);
  });

  it("collects the session, recent files, collections and history once each", () => {
    localStorage.setItem("vivepdf.recent", JSON.stringify([{ path: "C:/docs/recent.pdf", fileName: "recent.pdf", openedAt: 1 }, { path: "C:/docs/b.pdf", fileName: "b.pdf", openedAt: 2 }]));
    localStorage.setItem("vivepdf.collections", JSON.stringify([{ id: "c", name: "Work", color: "blue", paths: ["C:/work/plan.pdf"] }]));
    localStorage.setItem("vivepdf.history", JSON.stringify([{ id: "h", tool: "compress", source: "C:/in/big.pdf", outputs: ["C:/out/small.pdf"], at: 1 }]));

    expect(knownPaths(snapshot).sort()).toEqual(["C:/docs/a.pdf", "C:/docs/b.pdf", "C:/docs/inserted.pdf", "C:/docs/recent.pdf", "C:/in/big.pdf", "C:/out/small.pdf", "C:/work/plan.pdf"]);
  });

  it("has nothing to adopt without a session or stored lists and ignores broken ones", () => {
    localStorage.setItem("vivepdf.collections", "{");
    localStorage.setItem("vivepdf.history", JSON.stringify([{ id: 5 }]));

    expect(knownPaths(null)).toEqual([]);
  });

  it("asks the shell to adopt them from the main window only and survives a refusal", async () => {
    localStorage.setItem("vivepdf.recent", JSON.stringify([{ path: "C:/docs/recent.pdf", fileName: "recent.pdf", openedAt: 1 }]));
    invoke.mockRejectedValueOnce(new Error("no shell"));

    await expect(adoptKnownPaths()).resolves.toBeUndefined();
    mainWindow.mockReturnValue(false);
    await adoptKnownPaths();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("grants_adopt", { paths: ["C:/docs/recent.pdf"] });
  });
});
