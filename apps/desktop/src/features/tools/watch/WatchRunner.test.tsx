import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchRule } from "@/shared/store/watchStore";

const invoke = vi.fn();
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const runChain = vi.fn();
const listPdfs = vi.fn();
const moveToFolder = vi.fn();
const storedSecretsOf = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  },
}));
vi.mock("@/features/tools/batch/chain", () => ({
  chainProblem: () => null,
  readSavedChains: () => [{ id: "chain", name: "Chain", steps: [{ operation: "compress", settings: {} }], mergeAtEnd: false }],
  reconcileStoredSecrets: async () => undefined,
  runChain: (...args: unknown[]) => runChain(...args),
  storedSecretsOf: (...args: unknown[]) => storedSecretsOf(...args),
}));

vi.mock("@/shared/rpc/operations", () => ({
  listPdfs: (...args: unknown[]) => listPdfs(...args),
  moveToFolder: (...args: unknown[]) => moveToFolder(...args),
}));

import { useWatchStore } from "@/shared/store/watchStore";
import { WatchRunner } from "./WatchRunner";

const rule = (patch: Partial<WatchRule> = {}): WatchRule => ({ id: "a", folder: "C:/in", chainId: "chain", outputDir: "C:/out", recursive: false, enabled: true, ...patch });

function emit(name: string, payload: unknown) {
  act(() => handlers.get(name)?.({ payload }));
}

function statuses() {
  return useWatchStore.getState().log.map((entry) => `${entry.path}:${entry.status}`);
}

async function mount(rules: WatchRule[]) {
  useWatchStore.setState({ rules, log: [], problems: {}, pausedAt: null });
  render(<WatchRunner />);
  await vi.waitFor(() => expect(handlers.has("watch-file")).toBe(true));
}

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset().mockResolvedValue(undefined);
  runChain.mockReset();
  storedSecretsOf.mockReset().mockReturnValue([]);
  listPdfs.mockReset().mockResolvedValue({ files: [], entries: [], truncated: false });
  moveToFolder.mockReset().mockImplementation(async ({ path, folder }: { path: string; folder: string }) => ({ output: `${folder}/${path.split("/").pop()}` }));
  handlers.clear();
});

afterEach(() => {
  cleanup();
});

describe("WatchRunner", () => {
  it("watches the folder, leaves the output folder out and runs the chain on a new file", async () => {
    runChain.mockResolvedValue({ output: "C:/out/scan.pdf", bytes: 1 });
    await mount([rule()]);
    expect(invoke).toHaveBeenCalledWith("watch_folder_start", { id: "a", path: "C:/in", recursive: false, exclude: "C:/out", chainId: "chain" });
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:done"));
    expect(runChain.mock.calls[0][2]).toBe("C:/out");
  });

  it("refuses to start a rule that has no output folder", async () => {
    await mount([rule({ outputDir: "" })]);
    expect(invoke).not.toHaveBeenCalledWith("watch_folder_start", expect.anything());
    expect(useWatchStore.getState().problems.a).toBe("outputMissing");
  });

  it("stops the running file when its rule is turned off", async () => {
    let signal: AbortSignal | undefined;
    runChain.mockImplementation((_steps: unknown, _path: string, _dir: string, given: AbortSignal) => {
      signal = given;
      return new Promise((_, reject) => given.addEventListener("abort", () => reject(new Error("cancelled"))));
    });
    await mount([rule()]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(signal).toBeDefined());
    act(() => useWatchStore.getState().toggle("a"));
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:cancelled"));
    expect(signal?.aborted).toBe(true);
    expect(invoke).toHaveBeenCalledWith("watch_folder_stop", { id: "a" });
  });

  it("runs a file again when it changed during its run, but not when it is unchanged", async () => {
    let finish: (() => void) | undefined;
    runChain.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ output: "C:/out/scan.pdf", bytes: 1 }))));
    runChain.mockResolvedValue({ output: "C:/out/scan (2).pdf", bytes: 1 });
    await mount([rule()]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(finish).toBeDefined());
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 20, modified: 2 });
    finish?.();
    await vi.waitFor(() => expect(runChain).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:done"));
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 20, modified: 2 });
    await act(async () => undefined);
    expect(runChain).toHaveBeenCalledTimes(2);
  });

  it("skips a file that travelled back to the rule that produced it", async () => {
    runChain.mockResolvedValueOnce({ output: "C:/out/scan.pdf", bytes: 1 }).mockResolvedValueOnce({ output: "C:/in/scan (2).pdf", bytes: 1 });
    await mount([rule(), rule({ id: "b", folder: "C:/out", outputDir: "C:/in" })]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:done"));
    emit("watch-file", { id: "b", path: "C:/out/scan.pdf", size: 10, modified: 2 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/out/scan.pdf:done"));
    emit("watch-file", { id: "a", path: "C:/in/scan (2).pdf", size: 10, modified: 3 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan (2).pdf:cancelled"));
    expect(runChain).toHaveBeenCalledTimes(2);
  });

  it("marks a rule whose folder disappeared and stops its watcher", async () => {
    await mount([rule()]);
    emit("watch-folder-lost", { id: "a", path: "C:/in", size: 0, modified: 0 });
    expect(invoke).toHaveBeenCalledWith("watch_folder_stop", { id: "a" });
    expect(useWatchStore.getState().problems.a).toBe("folderMissing");
    expect(statuses()[0]).toBe("C:/in:error");
  });

  it("keeps numbering across files of a rule and saves the counter", async () => {
    runChain.mockImplementation(async (_steps: unknown, path: string, _dir: string, _signal: unknown, _step: unknown, _password: unknown, context: { numbering: number }) => {
      context.numbering += 3;
      return { output: path.replace("C:/in", "C:/out"), bytes: 1 };
    });
    await mount([rule({ numbering: 5 })]);
    emit("watch-file", { id: "a", path: "C:/in/one.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(useWatchStore.getState().rules[0].numbering).toBe(8));
    emit("watch-file", { id: "a", path: "C:/in/two.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(useWatchStore.getState().rules[0].numbering).toBe(11));
  });

  it("moves a finished source into the processed folder and a failed one into the failed folder", async () => {
    runChain.mockResolvedValueOnce({ output: "C:/out/good.pdf", bytes: 1 }).mockRejectedValueOnce(new Error("broken"));
    await mount([rule({ moveSources: true, processedName: "Done", failedName: "Bad" })]);
    emit("watch-file", { id: "a", path: "C:/in/good.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/good.pdf:done"));
    emit("watch-file", { id: "a", path: "C:/in/bad.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/bad.pdf:error"));
    expect(moveToFolder.mock.calls).toEqual([[{ path: "C:/in/good.pdf", folder: "C:/in/Done" }], [{ path: "C:/in/bad.pdf", folder: "C:/in/Bad" }]]);
    const [bad, good] = useWatchStore.getState().log;
    expect(good).toMatchObject({ ruleId: "a", movedTo: "C:/in/Done/good.pdf" });
    expect(bad).toMatchObject({ ruleId: "a", movedTo: "C:/in/Bad/bad.pdf" });
  });

  it("keeps a finished file done when moving its source fails", async () => {
    runChain.mockResolvedValue({ output: "C:/out/scan.pdf", bytes: 1 });
    moveToFolder.mockRejectedValue(new Error("locked"));
    await mount([rule({ moveSources: true, processedName: "Done", failedName: "Bad" })]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:done"));
    const entry = useWatchStore.getState().log[0];
    expect(entry.movedTo).toBeUndefined();
    expect(entry.error).toBeTruthy();
  });

  it("ignores files that land in the processed or failed folder", async () => {
    await mount([rule({ recursive: true, moveSources: true, processedName: "Done", failedName: "Bad" })]);
    emit("watch-file", { id: "a", path: "C:/in/Done/scan.pdf", size: 10, modified: 1 });
    emit("watch-file", { id: "a", path: "C:/in/bad/scan.pdf", size: 10, modified: 1 });
    await act(async () => undefined);
    expect(runChain).not.toHaveBeenCalled();
    expect(statuses()).toEqual([]);
  });

  it("processes files that were already waiting when the rule starts", async () => {
    runChain.mockResolvedValue({ output: "C:/out/old.pdf", bytes: 1 });
    listPdfs.mockResolvedValue({ files: ["C:/in/old.pdf"], entries: [{ path: "C:/in/old.pdf", size: 10, modified: 1 }], truncated: false });
    await mount([rule({ catchUp: true, moveSources: true, processedName: "Done", failedName: "Bad" })]);
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/old.pdf:done"));
    expect(listPdfs).toHaveBeenCalledWith({ folder: "C:/in", recursive: false, exclude: ["C:/out", "C:/in/Done", "C:/in/Bad"] });
  });

  it("does not look for waiting files unless the rule asks for it", async () => {
    await mount([rule()]);
    await act(async () => undefined);
    expect(listPdfs).not.toHaveBeenCalled();
  });

  it("restarts the watcher when an edit changes the watched folder", async () => {
    await mount([rule()]);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("watch_folder_start", expect.objectContaining({ path: "C:/in" })));
    act(() => useWatchStore.getState().update("a", { folder: "C:/scans" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("watch_folder_start", { id: "a", path: "C:/scans", recursive: false, exclude: "C:/out", chainId: "chain" }));
    expect(invoke).toHaveBeenCalledWith("watch_folder_stop", { id: "a" });
  });
  it("pausing stops the watcher and resuming picks up only files that arrived meanwhile", async () => {
    runChain.mockResolvedValue({ output: "C:/out/x.pdf", bytes: 1 });
    await mount([rule()]);
    expect(invoke).toHaveBeenCalledWith("watch_folder_start", expect.objectContaining({ id: "a" }));
    const pausedAt = Date.now() - 600000;
    act(() => useWatchStore.setState({ pausedAt }));
    expect(invoke).toHaveBeenCalledWith("watch_folder_stop", { id: "a" });
    emit("watch-file", { id: "a", path: "C:/in/ignored.pdf", size: 10, modified: pausedAt });
    listPdfs.mockResolvedValue({
      files: [],
      entries: [
        { path: "C:/in/old.pdf", size: 5, modified: pausedAt - 60000 },
        { path: "C:/in/new.pdf", size: 5, modified: pausedAt + 10000 },
      ],
      truncated: false,
    });
    invoke.mockClear();
    act(() => useWatchStore.getState().setPaused(false));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("watch_folder_start", expect.objectContaining({ id: "a" })));
    await vi.waitFor(() => expect(listPdfs).toHaveBeenCalled());
    await vi.waitFor(() => expect(runChain).toHaveBeenCalledTimes(1));
    expect(runChain.mock.calls[0][1]).toBe("C:/in/new.pdf");
    expect(statuses().some((entry) => entry.startsWith("C:/in/ignored.pdf"))).toBe(false);
  });
  it("runs a chain with stored passwords under a ticket for that file and hands the ticket back", async () => {
    storedSecretsOf.mockReturnValue(["encrypt"]);
    invoke.mockImplementation(async (command: string) => (command === "watch_ticket" ? "ticket-1" : undefined));
    runChain.mockResolvedValue({ output: "C:/out/scan.pdf", bytes: 1 });
    await mount([rule()]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:done"));
    expect(invoke).toHaveBeenCalledWith("watch_ticket", { ruleId: "a", path: "C:/in/scan.pdf" });
    expect(runChain.mock.calls[0][8]).toEqual({ chainId: "chain", ticket: "ticket-1", kinds: ["encrypt"] });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("watch_ticket_release", { ticket: "ticket-1" }));
  });

  it("logs a refused ticket as a failure without running the chain", async () => {
    storedSecretsOf.mockReturnValue(["sign"]);
    invoke.mockImplementation(async (command: string) => {
      if (command === "watch_ticket") throw { code: "TICKET_INVALID", message: "no" };
      return undefined;
    });
    await mount([rule()]);
    emit("watch-file", { id: "a", path: "C:/in/scan.pdf", size: 10, modified: 1 });
    await vi.waitFor(() => expect(statuses()[0]).toBe("C:/in/scan.pdf:error"));
    expect(runChain).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("watch_ticket_release", expect.anything());
  });
});
