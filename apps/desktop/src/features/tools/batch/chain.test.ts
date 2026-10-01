import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { document: { documentElement: { lang: string; dir: string } } }).document = {
  documentElement: { lang: "", dir: "" },
};

const { CHAINS_STORAGE_KEY, chainOutputPath, defaultStepSettings, persistSavedChains, readSavedChains } = await import("./chain");
const { ready, setLocale } = await import("@/app/i18n");
type SavedChain = Awaited<ReturnType<typeof readSavedChains>>[number];

function chainWithSecrets(): SavedChain {
  return {
    id: "1",
    name: "test",
    mergeAtEnd: false,
    steps: [
      { operation: "encrypt", settings: { ...defaultStepSettings(), password: "hunter2" } },
      { operation: "sign", settings: { ...defaultStepSettings(), certificatePath: "/cert.pfx", certificatePassword: "s3cret" } },
    ],
  };
}

describe("chain secret handling", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("strips password and certificatePassword when persisting", () => {
    persistSavedChains([chainWithSecrets()]);
    const raw = JSON.parse(localStorage.getItem(CHAINS_STORAGE_KEY) ?? "[]") as SavedChain[];
    expect(raw[0].steps[0].settings.password).toBe("");
    expect(raw[0].steps[1].settings.certificatePassword).toBe("");
  });

  it("keeps non-secret settings intact when persisting", () => {
    persistSavedChains([chainWithSecrets()]);
    const raw = JSON.parse(localStorage.getItem(CHAINS_STORAGE_KEY) ?? "[]") as SavedChain[];
    expect(raw[0].steps[1].settings.certificatePath).toBe("/cert.pfx");
  });

  it("purges pre-existing stored secrets on read", () => {
    localStorage.setItem(CHAINS_STORAGE_KEY, JSON.stringify([chainWithSecrets()]));
    const loaded = readSavedChains();
    expect(loaded[0].steps[0].settings.password).toBe("");
    const rewritten = JSON.parse(localStorage.getItem(CHAINS_STORAGE_KEY) ?? "[]") as SavedChain[];
    expect(rewritten[0].steps[1].settings.certificatePassword).toBe("");
  });

  it("returns an empty array for malformed storage", () => {
    localStorage.setItem(CHAINS_STORAGE_KEY, "not-json");
    expect(readSavedChains()).toEqual([]);
  });
});

describe("chain output naming", () => {
  it("uses the active locale's suffix", async () => {
    await ready();
    await setLocale("en");
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", false)).toBe("C:/out/report-compressed.pdf");
    await setLocale("tr");
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", false)).toBe("C:/out/report-sikistirilmis.pdf");
  });

  it("names page-numbered outputs with a file suffix rather than the field label", async () => {
    await setLocale("en");
    expect(chainOutputPath("C:/docs/report.pdf", "number", "C:/out", "png", false)).toBe("C:/out/report-numbered.pdf");
    await setLocale("tr");
    expect(chainOutputPath("C:/docs/report.pdf", "number", "C:/out", "png", false)).toBe("C:/out/report-numarali.pdf");
  });

  it("keeps intermediate steps out of the way of the folder watcher", async () => {
    await setLocale("en");
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", true)).toContain(".tmp-vivepdf.pdf");
  });
});

describe("chain password handling", () => {
  it("carries the source password into every step and swaps it after an encrypt step", async () => {
    const seen: { operation: string; password?: string }[] = [];
    vi.doMock("@/shared/rpc/operations", () => ({
      compressPdf: async (params: { path: string; output: string; password?: string }) => {
        seen.push({ operation: "compress", password: params.password });
        return { output: params.output, bytesAfter: 1 };
      },
      encryptPdf: async (params: { path: string; output: string; password?: string }) => {
        seen.push({ operation: "encrypt", password: params.password });
        return { output: params.output, bytes: 1 };
      },
      convertToDocx: async () => ({ output: "", bytes: 0 }),
      convertToHtml: async () => ({ output: "", bytes: 0 }),
      convertToImages: async () => ({ output: "", bytes: 0 }),
      convertToMarkdown: async () => ({ output: "", bytes: 0 }),
      convertToPptx: async () => ({ output: "", bytes: 0 }),
      convertToText: async () => ({ output: "", bytes: 0 }),
      convertToXlsx: async () => ({ output: "", bytes: 0 }),
      numberPages: async () => ({ output: "", bytes: 0, pageCount: 0 }),
      removeWatermark: async () => ({ output: "", bytes: 0 }),
      runOcr: async () => ({ output: "", bytes: 0 }),
      signPdf: async () => ({ output: "", bytes: 0 }),
    }));
    vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    await runChain(
      [
        { operation: "compress", settings: freshSettings() },
        { operation: "encrypt", settings: { ...freshSettings(), password: "yeni" } },
        { operation: "compress", settings: freshSettings() },
      ],
      "C:/docs/rapor.pdf",
      "C:/out",
      new AbortController().signal,
      undefined,
      "eski",
    );
    expect(seen.map((entry) => entry.password)).toEqual(["eski", "eski", "yeni"]);
  });
});

describe("chain cleanup", () => {
  it("removes the working file when a later step fails", async () => {
    const deleted: string[] = [];
    vi.doMock("@/shared/rpc/operations", () => ({
      compressPdf: async (params: { output: string }) => ({ output: params.output, bytesAfter: 1 }),
      encryptPdf: async () => {
        throw new Error("no");
      },
      convertToDocx: async () => ({ output: "", bytes: 0 }),
      convertToHtml: async () => ({ output: "", bytes: 0 }),
      convertToImages: async () => ({ output: "", bytes: 0 }),
      convertToMarkdown: async () => ({ output: "", bytes: 0 }),
      convertToPptx: async () => ({ output: "", bytes: 0 }),
      convertToText: async () => ({ output: "", bytes: 0 }),
      convertToXlsx: async () => ({ output: "", bytes: 0 }),
      numberPages: async () => ({ output: "", bytes: 0, pageCount: 0 }),
      removeWatermark: async () => ({ output: "", bytes: 0 }),
      runOcr: async () => ({ output: "", bytes: 0 }),
      signPdf: async () => ({ output: "", bytes: 0 }),
    }));
    vi.doMock("@/shared/rpc/files", () => ({
      deleteFile: async (path: string) => {
        deleted.push(path);
      },
    }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    await expect(
      runChain(
        [
          { operation: "compress", settings: freshSettings() },
          { operation: "encrypt", settings: { ...freshSettings(), password: "x" } },
        ],
        "C:/docs/rapor.pdf",
        "C:/out",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(deleted.some((path) => path.includes("tmp-vivepdf"))).toBe(true);
  });

  it("leaves nothing behind when every step works", async () => {
    const deleted: string[] = [];
    vi.doMock("@/shared/rpc/operations", () => ({
      compressPdf: async (params: { output: string }) => ({ output: params.output, bytesAfter: 1 }),
      encryptPdf: async (params: { output: string }) => ({ output: params.output, bytes: 1 }),
      convertToDocx: async () => ({ output: "", bytes: 0 }),
      convertToHtml: async () => ({ output: "", bytes: 0 }),
      convertToImages: async () => ({ output: "", bytes: 0 }),
      convertToMarkdown: async () => ({ output: "", bytes: 0 }),
      convertToPptx: async () => ({ output: "", bytes: 0 }),
      convertToText: async () => ({ output: "", bytes: 0 }),
      convertToXlsx: async () => ({ output: "", bytes: 0 }),
      numberPages: async () => ({ output: "", bytes: 0, pageCount: 0 }),
      removeWatermark: async () => ({ output: "", bytes: 0 }),
      runOcr: async () => ({ output: "", bytes: 0 }),
      signPdf: async () => ({ output: "", bytes: 0 }),
    }));
    vi.doMock("@/shared/rpc/files", () => ({
      deleteFile: async (path: string) => {
        deleted.push(path);
      },
    }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    const result = await runChain(
      [
        { operation: "compress", settings: freshSettings() },
        { operation: "encrypt", settings: { ...freshSettings(), password: "x" } },
      ],
      "C:/docs/rapor.pdf",
      "C:/out",
      new AbortController().signal,
    );
    expect(result.output.includes("tmp-vivepdf")).toBe(false);
    expect(deleted.filter((path) => path === result.output)).toEqual([]);
  });
});

function mockOperations(calls: { operation: string; path: string; output: string; start?: number }[]) {
  vi.doMock("@/shared/rpc/operations", () => ({
    compressPdf: async (params: { path: string; output: string }) => {
      calls.push({ operation: "compress", path: params.path, output: params.output });
      return { output: params.output, bytesAfter: 1 };
    },
    encryptPdf: async (params: { path: string; output: string; userPassword?: string }) => {
      if (params.userPassword === "fail") throw new Error("boom");
      calls.push({ operation: "encrypt", path: params.path, output: params.output });
      return { output: params.output, bytes: 1 };
    },
    numberPages: async (params: { path: string; output: string; start: number }) => {
      calls.push({ operation: "number", path: params.path, output: params.output, start: params.start });
      return { output: params.output, bytes: 1, pageCount: 4 };
    },
    convertToDocx: async () => ({ output: "", bytes: 0 }),
    convertToHtml: async () => ({ output: "", bytes: 0 }),
    convertToImages: async () => ({ output: "", bytes: 0 }),
    convertToMarkdown: async () => ({ output: "", bytes: 0 }),
    convertToPptx: async () => ({ output: "", bytes: 0 }),
    convertToText: async () => ({ output: "", bytes: 0 }),
    convertToXlsx: async () => ({ output: "", bytes: 0 }),
    removeWatermark: async () => ({ output: "", bytes: 0 }),
    runOcr: async () => ({ output: "", bytes: 0 }),
    signPdf: async () => ({ output: "", bytes: 0 }),
  }));
  vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
}

describe("chain naming and context", () => {
  it("never feeds a step its own output when the same operation repeats", async () => {
    const calls: { operation: string; path: string; output: string }[] = [];
    mockOperations(calls);
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    await runChain(
      [
        { operation: "compress", settings: freshSettings() },
        { operation: "compress", settings: freshSettings() },
        { operation: "encrypt", settings: { ...freshSettings(), password: "x" } },
      ],
      "C:/docs/rapor.pdf",
      "C:/out",
      new AbortController().signal,
    );
    for (const call of calls) expect(call.path).not.toBe(call.output);
    expect(new Set(calls.map((call) => call.output)).size).toBe(3);
  });

  it("gives two sources with the same name different outputs in one run", async () => {
    const calls: { operation: string; path: string; output: string }[] = [];
    mockOperations(calls);
    vi.resetModules();
    const { runChain, createChainContext, defaultStepSettings: freshSettings } = await import("./chain");
    const context = createChainContext();
    const steps = [{ operation: "compress" as const, settings: freshSettings() }];
    const first = await runChain(steps, "C:/a/rapor.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    const second = await runChain(steps, "C:/b/rapor.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    expect(first.output).not.toBe(second.output);
    expect(second.output.endsWith(" (2).pdf")).toBe(true);
  });

  it("continues page numbers within one context and restarts in a new one", async () => {
    const calls: { operation: string; path: string; output: string; start?: number }[] = [];
    mockOperations(calls);
    vi.resetModules();
    const { runChain, createChainContext, defaultStepSettings: freshSettings } = await import("./chain");
    const steps = [{ operation: "number" as const, settings: freshSettings() }];
    const context = createChainContext();
    await runChain(steps, "C:/a/one.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    await runChain(steps, "C:/a/two.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    await runChain(steps, "C:/a/three.pdf", "C:/out", new AbortController().signal, undefined, undefined, createChainContext());
    expect(calls.map((call) => call.start)).toEqual([1, 5, 1]);
  });

  it("does not advance page numbers for a file whose chain failed", async () => {
    const calls: { operation: string; path: string; output: string; start?: number }[] = [];
    mockOperations(calls);
    vi.resetModules();
    const { runChain, createChainContext, defaultStepSettings: freshSettings } = await import("./chain");
    const context = createChainContext();
    const failing = [
      { operation: "number" as const, settings: freshSettings() },
      { operation: "encrypt" as const, settings: { ...freshSettings(), password: "fail" } },
    ];
    await expect(runChain(failing, "C:/a/one.pdf", "C:/out", new AbortController().signal, undefined, undefined, context)).rejects.toThrow("boom");
    await runChain([{ operation: "number", settings: freshSettings() }], "C:/a/two.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    expect(calls.filter((call) => call.operation === "number").map((call) => call.start)).toEqual([1, 1]);
    expect(context.numbering).toBe(4);
  });

  it("numbers every numbering step of one file from the same start", async () => {
    const calls: { operation: string; path: string; output: string; start?: number }[] = [];
    mockOperations(calls);
    vi.resetModules();
    const { runChain, createChainContext, defaultStepSettings: freshSettings } = await import("./chain");
    const context = createChainContext();
    const twice = [
      { operation: "number" as const, settings: freshSettings() },
      { operation: "number" as const, settings: freshSettings() },
    ];
    await runChain(twice, "C:/a/one.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    await runChain(twice, "C:/a/two.pdf", "C:/out", new AbortController().signal, undefined, undefined, context);
    expect(calls.map((call) => call.start)).toEqual([1, 1, 5, 5]);
  });

  it("returns the password the final file is protected with", async () => {
    mockOperations([]);
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    const plain = await runChain([{ operation: "compress", settings: freshSettings() }], "C:/a/x.pdf", "C:/out", new AbortController().signal, undefined, "eski");
    const locked = await runChain([{ operation: "encrypt", settings: { ...freshSettings(), password: "yeni" } }], "C:/a/y.pdf", "C:/out", new AbortController().signal);
    expect(plain.password).toBe("eski");
    expect(locked.password).toBe("yeni");
  });
});

describe("claimOutputPath", () => {
  it("numbers a name that is already taken, ignoring case and separators", async () => {
    const { claimOutputPath } = await import("./chain");
    const taken = new Set<string>();
    expect(claimOutputPath("C:\\out\\Rapor.pdf", taken)).toBe("C:\\out\\Rapor.pdf");
    expect(claimOutputPath("c:/out/rapor.pdf", taken)).toBe("c:/out/rapor (2).pdf");
    expect(claimOutputPath("C:/out/rapor.pdf", taken)).toBe("C:/out/rapor (3).pdf");
    expect(claimOutputPath("C:/out/images", taken)).toBe("C:/out/images");
  });
});

describe("claimFreeOutputPath", () => {
  it("skips names that already exist on disk and returns the actual output of the chain", async () => {
    const calls: { path: string; output: string; overwrite: boolean }[] = [];
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: async (command: string, args: { paths: string[] }) => {
        if (command !== "path_exists") throw new Error(command);
        return args.paths.map((path) => path.endsWith("rapor-compressed.pdf") || path.endsWith("rapor-compressed (2).pdf"));
      },
    }));
    mockOperations([]);
    vi.doMock("@/shared/rpc/operations", async () => ({
      ...(await vi.importActual<object>("@/shared/rpc/operations")),
      compressPdf: async (params: { path: string; output: string; overwrite: boolean }) => {
        calls.push({ path: params.path, output: params.output, overwrite: params.overwrite });
        return { output: params.output, bytesAfter: 1 };
      },
    }));
    vi.resetModules();
    const { runChain, chainOutputPath, defaultStepSettings: freshSettings } = await import("./chain");
    const planned = chainOutputPath("C:/in/rapor.pdf", "compress", "C:/out", "png", false);
    const result = await runChain([{ operation: "compress", settings: freshSettings() }], "C:/in/rapor.pdf", "C:/out", new AbortController().signal);
    const expected = planned.replace(/\.pdf$/, " (3).pdf");
    expect(result.output).toBe(expected);
    expect(calls).toEqual([{ path: "C:/in/rapor.pdf", output: expected, overwrite: false }]);
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("falls back to the planned name when the existence check is unavailable", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: async () => {
        throw new Error("no shell");
      },
    }));
    vi.resetModules();
    const { claimFreeOutputPath } = await import("./chain");
    const taken = new Set<string>();
    expect(await claimFreeOutputPath("C:/out/a.pdf", taken)).toBe("C:/out/a.pdf");
    expect(await claimFreeOutputPath("C:/out/a.pdf", taken)).toBe("C:/out/a (2).pdf");
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("looks past the first fifty numbered names instead of reusing one that exists", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: async (_command: string, args: { paths: string[] }) => args.paths.map((path) => !path.endsWith("(73).pdf")),
    }));
    vi.resetModules();
    const { claimFreeOutputPath } = await import("./chain");
    expect(await claimFreeOutputPath("C:/out/a.pdf", new Set())).toBe("C:/out/a (73).pdf");
    vi.doUnmock("@tauri-apps/api/core");
  });

  it("falls back to a time-stamped name when every numbered name exists", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: async (_command: string, args: { paths: string[] }) => args.paths.map(() => true),
    }));
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const { claimFreeOutputPath } = await import("./chain");
    expect(await claimFreeOutputPath("C:/out/a.pdf", new Set())).toBe("C:/out/a (1700000000000).pdf");
    vi.restoreAllMocks();
    vi.doUnmock("@tauri-apps/api/core");
  });
});

describe("chainProblem", () => {
  it("names what keeps a chain from running on its own", async () => {
    const { chainProblem, defaultStepSettings: freshSettings } = await import("./chain");
    expect(chainProblem(undefined)).toBe("empty");
    expect(chainProblem([])).toBe("empty");
    expect(chainProblem([{ operation: "docx", settings: freshSettings() }, { operation: "compress", settings: freshSettings() }])).toBe("invalid");
    expect(chainProblem([{ operation: "encrypt", settings: freshSettings() }])).toBe("needsSecret");
    expect(chainProblem([{ operation: "compress", settings: freshSettings() }, { operation: "docx", settings: freshSettings() }])).toBeNull();
  });
});

describe("chain files", () => {
  it("round-trips chains without their secrets", async () => {
    const { serializeChains, parseChainFile, defaultStepSettings: freshSettings } = await import("./chain");
    const text = serializeChains([
      { id: "a", name: "Tara ve şifrele", mergeAtEnd: true, steps: [{ operation: "encrypt", settings: { ...freshSettings(), password: "gizli", profile: "strong" } }] },
    ]);
    expect(text).not.toContain("gizli");
    const [chain] = parseChainFile(text);
    expect(chain.name).toBe("Tara ve şifrele");
    expect(chain.mergeAtEnd).toBe(true);
    expect(chain.steps[0].operation).toBe("encrypt");
    expect(chain.steps[0].settings.profile).toBe("strong");
    expect(chain.steps[0].settings.password).toBe("");
  });

  it("drops unknown operations, fills missing settings and rejects foreign files", async () => {
    const { parseChainFile } = await import("./chain");
    const [chain] = parseChainFile(
      `\uFEFF${JSON.stringify([{ name: "x", steps: [{ operation: "format-disk" }, { operation: "compress", settings: { profile: "light", numberPadding: "9", password: "p" } }] }])}`,
    );
    expect(chain.steps).toHaveLength(1);
    expect(chain.steps[0].settings.profile).toBe("light");
    expect(chain.steps[0].settings.numberPadding).toBe(0);
    expect(chain.steps[0].settings.password).toBe("");
    expect(chain.id.length).toBeGreaterThan(0);
    const [imported] = parseChainFile(JSON.stringify([{ id: "someone-elses-chain", name: "x", steps: [{ operation: "compress" }] }]));
    expect(imported.id).not.toBe("someone-elses-chain");
    expect(() => parseChainFile("{}")).toThrow();
    expect(() => parseChainFile("not json")).toThrow();
    expect(() => parseChainFile(JSON.stringify([{ name: "", steps: [] }]))).toThrow();
  });

  it("replaces a same-named chain but keeps its id so watched folders still find it", async () => {
    const { mergeChains, upsertChain, defaultStepSettings: freshSettings } = await import("./chain");
    const step = { operation: "compress" as const, settings: freshSettings() };
    const existing = [{ id: "keep", name: "A", mergeAtEnd: false, steps: [step] }];
    const { chains: merged, replacedIds } = mergeChains(existing, [
      { id: "other", name: "A", mergeAtEnd: true, steps: [step, step] },
      { id: "keep", name: "B", mergeAtEnd: false, steps: [step] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "keep", name: "A", mergeAtEnd: true });
    expect(merged[1].name).toBe("B");
    expect(merged[1].id).not.toBe("keep");
    expect(replacedIds).toEqual(["keep"]);
    const saved = upsertChain(existing, "A", [step, step], true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "keep", mergeAtEnd: true });
    expect(upsertChain(existing, "C", [step], false)).toHaveLength(2);
  });
});

describe("page steps", () => {
  it("sends the chosen pages and rotation to the page operations", async () => {
    const calls: { operation: string; params: Record<string, unknown> }[] = [];
    const record = (operation: string) => async (params: Record<string, unknown>) => {
      calls.push({ operation, params });
      return { output: params.output, bytes: 1 };
    };
    vi.doMock("@/shared/rpc/operations", () => ({
      rotatePages: record("rotate"),
      deletePages: record("delete"),
      extractPages: record("extract"),
    }));
    vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    await runChain(
      [
        { operation: "rotate", settings: { ...freshSettings(), pageScope: "even", rotateDegrees: 270 } },
        { operation: "delete", settings: { ...freshSettings(), pageScope: "every", pageEvery: 3, pageStart: 2 } },
        { operation: "extract", settings: { ...freshSettings(), pageScope: "ranges", pageRanges: "1-2" } },
      ],
      "C:/docs/report.pdf",
      "C:/out",
      new AbortController().signal,
    );
    expect(calls.map((call) => call.operation)).toEqual(["rotate", "delete", "extract"]);
    expect(calls[0].params).toMatchObject({ scope: { kind: "even" }, degrees: 270 });
    expect(calls[1].params).toMatchObject({ scope: { kind: "every", every: 3, start: 2 } });
    expect(calls[2].params).toMatchObject({ scope: { kind: "ranges", ranges: "1-2" } });
    vi.doUnmock("@/shared/rpc/operations");
    vi.doUnmock("@/shared/rpc/files");
    vi.resetModules();
  });

  it("needs ranges before a ranges step can run", async () => {
    const { stepIsReady, defaultStepSettings: freshSettings } = await import("./chain");
    expect(stepIsReady({ operation: "extract", settings: { ...freshSettings(), pageScope: "ranges", pageRanges: " " } })).toBe(false);
    expect(stepIsReady({ operation: "extract", settings: { ...freshSettings(), pageScope: "ranges", pageRanges: "2-" } })).toBe(true);
    expect(stepIsReady({ operation: "delete", settings: freshSettings() })).toBe(true);
  });

  it("repairs an unknown page choice or rotation read from a chain file", async () => {
    const { parseChainFile } = await import("./chain");
    const [chain] = parseChainFile(JSON.stringify([{ name: "x", steps: [{ operation: "rotate", settings: { pageScope: "prime", rotateDegrees: 45 } }] }]));
    expect(chain.steps[0].settings.pageScope).toBe("all");
    expect(chain.steps[0].settings.rotateDegrees).toBe(90);
  });
});

describe("document steps", () => {
  it("sends watermark, header and footer, properties, PDF/A and repair settings to their operations", async () => {
    const calls: { operation: string; params: Record<string, unknown> }[] = [];
    const record = (operation: string) => async (params: Record<string, unknown>) => {
      calls.push({ operation, params });
      return { output: params.output, bytes: 1, pageCount: 1 };
    };
    vi.doMock("@/shared/rpc/operations", () => ({
      repairPdf: record("repair"),
      watermarkPdf: record("watermark"),
      headerFooter: record("headerFooter"),
      setMetadata: record("metadata"),
      convertPdfa: record("pdfa"),
    }));
    vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    await runChain(
      [
        { operation: "repair", settings: freshSettings() },
        { operation: "watermark", settings: { ...freshSettings(), markText: "TASLAK", markOpacity: 40, markPosition: "tile" } },
        { operation: "headerFooter", settings: { ...freshSettings(), footerCenter: "{n} / {total}" } },
        { operation: "metadata", settings: { ...freshSettings(), metaTitle: "Dosya {name}", metaAuthor: " " } },
        { operation: "pdfa", settings: { ...freshSettings(), pdfaLevel: "3b" } },
      ],
      "C:/docs/report.pdf",
      "C:/out",
      new AbortController().signal,
    );
    expect(calls.map((call) => call.operation)).toEqual(["repair", "watermark", "headerFooter", "metadata", "pdfa"]);
    expect(calls[1].params).toMatchObject({ kind: "text", text: "TASLAK", opacity: 0.4, position: "tile" });
    expect(calls[2].params).toMatchObject({ footerCenter: "{n} / {total}", headerLeft: "" });
    expect(calls[3].params).toMatchObject({ inPlace: false, title: "Dosya report", author: undefined });
    expect(calls[4].params).toMatchObject({ level: "3b" });
    vi.doUnmock("@/shared/rpc/operations");
    vi.doUnmock("@/shared/rpc/files");
    vi.resetModules();
  });

  it("needs content before a watermark, header and footer or properties step can run", async () => {
    const { stepIsReady, defaultStepSettings: freshSettings } = await import("./chain");
    expect(stepIsReady({ operation: "watermark", settings: freshSettings() })).toBe(false);
    expect(stepIsReady({ operation: "watermark", settings: { ...freshSettings(), markText: "GİZLİ" } })).toBe(true);
    expect(stepIsReady({ operation: "headerFooter", settings: freshSettings() })).toBe(false);
    expect(stepIsReady({ operation: "headerFooter", settings: { ...freshSettings(), headerRight: "{date}" } })).toBe(true);
    expect(stepIsReady({ operation: "metadata", settings: { ...freshSettings(), metaKeywords: "  " } })).toBe(false);
    expect(stepIsReady({ operation: "repair", settings: freshSettings() })).toBe(true);
  });

  it("repairs an unknown level, position or colour read from a chain file", async () => {
    const { parseChainFile } = await import("./chain");
    const [chain] = parseChainFile(JSON.stringify([{ name: "x", steps: [{ operation: "watermark", settings: { markPosition: "sky", markColor: "red", pdfaLevel: "9z" } }] }]));
    expect(chain.steps[0].settings.markPosition).toBe("center");
    expect(chain.steps[0].settings.markColor).toBe("#c00000");
    expect(chain.steps[0].settings.pdfaLevel).toBe("2b");
  });
});

describe("output name pattern", () => {
  it("names the final file from the pattern with the list position", async () => {
    const { chainOutputPath } = await import("./chain");
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", false, 0, { template: "{n}-{name}", n: 7 })).toBe("C:/out/7-report.pdf");
    expect(chainOutputPath("C:/docs/report.pdf", "docx", "C:/out", "png", false, 0, { template: "{name}_{n}", n: 2 })).toBe("C:/out/report_2.docx");
  });

  it("falls back to the default name for an empty or unusable pattern", async () => {
    const { chainOutputPath, nameTemplateIsValid } = await import("./chain");
    const fallback = chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", false);
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", false, 0, { template: "fixed" })).toBe(fallback);
    expect(nameTemplateIsValid("")).toBe(true);
    expect(nameTemplateIsValid("fixed")).toBe(false);
    expect(nameTemplateIsValid("scan-{n}")).toBe(true);
  });

  it("keeps intermediate working files out of the pattern", async () => {
    const { chainOutputPath } = await import("./chain");
    expect(chainOutputPath("C:/docs/report.pdf", "compress", "C:/out", "png", true, 0, { template: "{n}", n: 3 })).toMatch(/report\.1-.*\.tmp-vivepdf\.pdf$/);
  });

  it("stores the pattern with a saved chain and reads it back from a chain file", async () => {
    const { upsertChain, parseChainFile, serializeChains, defaultStepSettings: freshSettings } = await import("./chain");
    const saved = upsertChain([], "Arşiv", [{ operation: "compress", settings: freshSettings() }], false, " {date}-{name} ");
    expect(saved[0].nameTemplate).toBe("{date}-{name}");
    expect(parseChainFile(serializeChains(saved))[0].nameTemplate).toBe("{date}-{name}");
    const [broken] = parseChainFile(JSON.stringify([{ name: "y", nameTemplate: "same", steps: [{ operation: "compress" }] }]));
    expect(broken.nameTemplate).toBeUndefined();
  });

  it("counts files through the context when no position is given", async () => {
    vi.doMock("@/shared/rpc/operations", () => ({ compressPdf: async (params: { output: string }) => ({ output: params.output, bytesAfter: 1 }) }));
    vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
    vi.resetModules();
    const { runChain, createChainContext, defaultStepSettings: freshSettings } = await import("./chain");
    const context = createChainContext();
    const steps = [{ operation: "compress" as const, settings: freshSettings() }];
    const first = await runChain(steps, "C:/in/a.pdf", "C:/out", new AbortController().signal, undefined, undefined, context, { template: "scan-{n}" });
    const second = await runChain(steps, "C:/in/b.pdf", "C:/out", new AbortController().signal, undefined, undefined, context, { template: "scan-{n}" });
    expect([first.output, second.output]).toEqual(["C:/out/scan-1.pdf", "C:/out/scan-2.pdf"]);
    vi.doUnmock("@/shared/rpc/operations");
    vi.doUnmock("@/shared/rpc/files");
    vi.resetModules();
  });
});

describe("stored chain secrets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the stored-secret marks locally but never exports them", async () => {
    const { serializeChains } = await import("./chain");
    const chain = { ...chainWithSecrets(), storedSecrets: ["encrypt", "sign"] as SavedChain["storedSecrets"] };
    persistSavedChains([chain]);
    expect(readSavedChains()[0].storedSecrets).toEqual(["encrypt", "sign"]);
    const exported = serializeChains([chain]);
    expect(exported).not.toContain("storedSecrets");
    expect(exported).not.toContain("hunter2");
    expect(exported).not.toContain("s3cret");
  });

  it("offers to remember only the passwords a step actually carries", async () => {
    const { secretsToRemember } = await import("./chain");
    expect(secretsToRemember(chainWithSecrets().steps)).toEqual([
      { kind: "encrypt", secret: "hunter2" },
      { kind: "sign", secret: "s3cret", certificatePath: "/cert.pfx" },
    ]);
    const blank = chainWithSecrets().steps.map((step) => ({ ...step, settings: { ...step.settings, password: "", certificatePassword: "" } }));
    expect(secretsToRemember(blank)).toEqual([]);
    const noCertificate = [{ operation: "sign" as const, settings: { ...defaultStepSettings(), certificatePath: "", certificatePassword: "pin" } }];
    expect(secretsToRemember(noCertificate)).toEqual([]);
  });

  it("drops marks for kinds the chain no longer has and marks from unknown kinds", () => {
    localStorage.setItem(
      CHAINS_STORAGE_KEY,
      JSON.stringify([{ id: "1", name: "x", mergeAtEnd: false, steps: [{ operation: "compress", settings: defaultStepSettings() }], storedSecrets: ["encrypt", "root"] }]),
    );
    expect(readSavedChains()[0].storedSecrets).toBeUndefined();
  });

  it("follows the keychain status and keeps marks through a re-save of the same steps", async () => {
    const { withSecretStatus, upsertChain, secretKindsOf, chainProblem } = await import("./chain");
    const chain = chainWithSecrets();
    const [synced] = withSecretStatus([chain], [{ chainId: "1", encrypt: true, sign: false }]);
    expect(synced.storedSecrets).toEqual(["encrypt"]);
    expect(withSecretStatus([synced], [])[0].storedSecrets).toBeUndefined();
    expect(secretKindsOf(chain.steps)).toEqual(["encrypt", "sign"]);
    const [resaved] = upsertChain([synced], "test", synced.steps, false);
    expect(resaved.storedSecrets).toEqual(["encrypt"]);
    const [trimmed] = upsertChain([synced], "test", [synced.steps[1]], false);
    expect(trimmed.storedSecrets).toBeUndefined();
    const withoutPassword = [{ operation: "encrypt" as const, settings: defaultStepSettings() }];
    expect(chainProblem(withoutPassword)).toBe("needsSecret");
    expect(chainProblem(withoutPassword, ["encrypt"])).toBeNull();
  });

  it("sends each step the stored secrets it needs and never a password of its own", async () => {
    const calls: { operation: string; params: Record<string, unknown>; secret: unknown }[] = [];
    const record = (operation: string) => async (params: Record<string, unknown>, options?: { secret?: unknown }) => {
      calls.push({ operation, params, secret: options?.secret });
      return { output: params.output, bytes: 1, bytesAfter: 1 };
    };
    vi.doMock("@/shared/rpc/operations", () => ({ compressPdf: record("compress"), encryptPdf: record("encrypt"), signPdf: record("sign") }));
    vi.doMock("@/shared/rpc/files", () => ({ deleteFile: async () => undefined }));
    vi.resetModules();
    const { runChain, defaultStepSettings: freshSettings } = await import("./chain");
    const vault = { chainId: "c", ticket: "t", kinds: ["encrypt", "sign"] as const };
    const result = await runChain(
      [
        { operation: "compress", settings: freshSettings() },
        { operation: "encrypt", settings: freshSettings() },
        { operation: "compress", settings: freshSettings() },
        { operation: "sign", settings: { ...freshSettings(), certificatePath: "C:/me.p12" } },
      ],
      "C:/in/a.pdf",
      "C:/out",
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      {},
      vault,
    );
    expect(calls.map((call) => call.secret)).toEqual([
      undefined,
      { chainId: "c", ticket: "t", kinds: ["encrypt"] },
      { chainId: "c", ticket: "t", kinds: ["encrypt"] },
      { chainId: "c", ticket: "t", kinds: ["encrypt", "sign"] },
    ]);
    expect(calls[1].params.userPassword).toBe("");
    expect(calls[2].params.password).toBeUndefined();
    expect(calls[3].params.certificatePassword).toBe("");
    expect(result.password).toBeUndefined();
    vi.doUnmock("@/shared/rpc/operations");
    vi.doUnmock("@/shared/rpc/files");
    vi.resetModules();
  });

  it("asks the keychain to drop secrets of chains that are gone", async () => {
    const invoke = vi.fn(async () => [{ chainId: "1", encrypt: false, sign: true }]);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    vi.resetModules();
    const chain = await import("./chain");
    chain.persistSavedChains([chainWithSecrets()]);
    await chain.reconcileStoredSecrets();
    expect(invoke).toHaveBeenCalledWith("chain_secret_prune", { liveChainIds: ["1"] });
    expect(chain.readSavedChains()[0].storedSecrets).toEqual(["sign"]);
    vi.doUnmock("@tauri-apps/api/core");
    vi.resetModules();
  });
});
