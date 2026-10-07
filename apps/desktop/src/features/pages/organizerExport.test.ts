import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizerTile } from "@/types";

vi.mock("@tauri-apps/api/path", () => ({ tempDir: async () => "C:/tmp", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@/shared/rpc/files", () => ({ deleteFile: vi.fn(async () => undefined) }));
vi.mock("@/shared/rpc/operations", () => ({ assemblePages: vi.fn(async () => ({ output: "", pageCount: 2, bytes: 10 })), insertPagesFrom: vi.fn(async () => ({ output: "", bytes: 10, inserted: 2 })) }));

const { copyPagesInto, directMainPages, exportSourceOf } = await import("./organizerExport");
const { assemblePages, insertPagesFrom } = await import("@/shared/rpc/operations");
const { deleteFile } = await import("@/shared/rpc/files");

const page = (index: number, extra: Partial<Extract<OrganizerTile, { kind: "page" }>> = {}): OrganizerTile => ({ key: `p${index}`, kind: "page", sourceId: "main", index, rotate: 0, ...extra });
const main = { path: "C:/docs/report.pdf", password: "pw" };
const arranged = { sources: [{ id: "main", path: main.path, password: "pw" }], pages: [] };

beforeEach(() => {
  vi.mocked(assemblePages).mockClear();
  vi.mocked(insertPagesFrom).mockClear();
  vi.mocked(deleteFile).mockClear();
});

describe("directMainPages", () => {
  it("prints or saves unchanged pages of the open file straight from it", () => {
    expect(directMainPages([page(1), page(2), page(3), page(5)])).toBe("1-3, 5");
  });

  it("needs a copy when pages are reordered, turned or come from elsewhere", () => {
    expect(directMainPages([page(2), page(1)])).toBeNull();
    expect(directMainPages([page(1, { rotate: 90 })])).toBeNull();
    expect(directMainPages([page(1, { sourceId: "other" })])).toBeNull();
    expect(directMainPages([{ key: "b", kind: "blank", width: 10, height: 10, rotate: 0 }])).toBeNull();
    expect(directMainPages([])).toBeNull();
  });
});

describe("exportSourceOf", () => {
  it("uses the open file without writing a copy for unchanged pages", async () => {
    const source = await exportSourceOf([page(4)], main, arranged);

    expect(source).toEqual({ path: main.path, password: "pw", pages: "4", pageCount: 1, temporary: false });
    expect(assemblePages).not.toHaveBeenCalled();
  });

  it("writes the arrangement to a temporary file", async () => {
    const source = await exportSourceOf([page(2), page(1)], main, arranged);

    expect(source).toMatchObject({ password: "pw", pages: null, pageCount: 2, temporary: true });
    expect(source.path).toMatch(/^C:\/tmp\/vivepdf-pages-.+\.pdf$/);
    expect(vi.mocked(assemblePages).mock.calls[0][0]).toMatchObject({ output: source.path, overwrite: true });
  });

  it("removes the half-written copy when arranging fails", async () => {
    vi.mocked(assemblePages).mockRejectedValueOnce(new Error("disk full"));

    await expect(exportSourceOf([page(2), page(1)], main, arranged)).rejects.toThrow("disk full");

    expect(deleteFile).toHaveBeenCalledWith(expect.stringMatching(/vivepdf-pages-.+\.pdf$/));
  });
});

describe("copyPagesInto", () => {
  const target = { path: "C:/docs/other.pdf", password: null };

  it("appends unchanged pages straight from the open file", async () => {
    const inserted = await copyPagesInto(target, [page(2), page(4)], main, arranged);

    expect(inserted).toBe(2);
    expect(vi.mocked(insertPagesFrom).mock.calls[0][0]).toEqual({ path: target.path, password: undefined, sourcePath: main.path, sourcePassword: "pw", sourcePages: [2, 4], at: 0 });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("appends every page of the arranged copy and then deletes the copy", async () => {
    await copyPagesInto(target, [page(3), page(1)], main, arranged);

    const params = vi.mocked(insertPagesFrom).mock.calls[0][0];
    expect(params.sourcePath).toMatch(/vivepdf-pages-.+\.pdf$/);
    expect(params.sourcePages).toEqual([1, 2]);
    expect(deleteFile).toHaveBeenCalledWith(params.sourcePath);
  });

  it("still deletes the copy when the target cannot take the pages", async () => {
    vi.mocked(insertPagesFrom).mockRejectedValueOnce(new Error("locked"));

    await expect(copyPagesInto(target, [page(3), page(1)], main, arranged)).rejects.toThrow("locked");

    expect(deleteFile).toHaveBeenCalledWith(expect.stringMatching(/vivepdf-pages-.+\.pdf$/));
  });
});
