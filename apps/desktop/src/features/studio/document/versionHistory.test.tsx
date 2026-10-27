import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import { useDocumentStore } from "./documentStore";
import { createDocument } from "./model";
import { useToastStore } from "@/shared/store/toastStore";
import { storeCitationSource } from "./citationSource";
import { AUTO_VERSION_MS, carryVersions, listVersions, parseVersion, readVersion, restoreVersion, serializeVersion, useAutoVersions } from "./versionHistory";
import { VersionHistoryDialog } from "./VersionHistoryDialog";

const backend = vi.hoisted(() => ({ files: new Map<string, string>(), writes: [] as { path: string; kind: string; contents: string }[], fail: false }));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args: Record<string, string>) => {
    if (backend.fail) throw { code: "INTERNAL", message: "disk full" };
    if (command === "document_versions_list") return [...backend.files.keys()].reverse().map((id, index) => ({ id, kind: id.split("-")[1], savedAt: Date.UTC(2026, 9, 27, 9, 30 - index), bytes: 2048 }));
    if (command === "document_versions_read") return backend.files.get(args.id) ?? null;
    if (command === "document_versions_write") {
      backend.writes.push({ path: args.path, kind: args.kind, contents: args.contents });
      const id = `${backend.writes.length}-${args.kind}-0123456789abcdef`;
      backend.files.set(id, args.contents);
      return { id, kind: args.kind, savedAt: Date.now(), bytes: args.contents.length };
    }
    return null;
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const PATH = "/Users/esma/tez.vpdoc";
const paragraph = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  backend.files.clear();
  backend.writes = [];
  backend.fail = false;
  invoke.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useDocumentStore.getState().close();
});

describe("version files", () => {
  it("round-trips a document through a version snapshot", () => {
    const document = createDocument("Tez", paragraph("Giriş"));

    const parsed = parseVersion(serializeVersion(document));

    expect(parsed?.name).toBe("Tez");
    expect(parsed?.content).toEqual(paragraph("Giriş"));
  });

  it("treats a missing, broken or foreign snapshot as no document", () => {
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("{nope")).toBeNull();
    expect(parseVersion(JSON.stringify({ kind: "design" }))).toBeNull();
  });

  it("drops malformed rows from the listing", async () => {
    invoke.mockResolvedValueOnce([{ id: "1-save-0123456789abcdef", kind: "save", savedAt: 1, bytes: 10 }, { id: 4, kind: "save" }, { id: "x", kind: "hack", savedAt: 1, bytes: 1 }] as never);

    const versions = await listVersions(PATH);

    expect(versions.map((version) => version.id)).toEqual(["1-save-0123456789abcdef"]);
  });

  it("reports a damaged snapshot as damaged rather than missing", async () => {
    backend.files.set("1-save-0123456789abcdef", "{nope");

    await expect(readVersion(PATH, "1-save-0123456789abcdef")).rejects.toMatchObject({ code: "INVALID_PARAMS", data: { reason: "versionDamaged" } });
    await expect(readVersion(PATH, "2-save-0123456789abcdef")).resolves.toBeNull();
  });

  it("asks the shell to carry the history to a new path and ignores a failure", async () => {
    await carryVersions("/eski/tez.vpdoc", "/yeni/tez.vpdoc");
    backend.fail = true;

    await expect(carryVersions("/a.vpdoc", "/b.vpdoc")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("document_versions_carry", { from: "/eski/tez.vpdoc", to: "/yeni/tez.vpdoc" });
  });

  it("reads citations and the references title from a version, not from the open document", () => {
    useDocumentStore.getState().open({ ...createDocument("Tez"), settings: { ...createDocument("Tez").settings, referencesTitle: "Kaynaklar" } }, PATH);
    const old = { ...createDocument("Eski"), settings: { ...createDocument("Eski").settings, referencesTitle: "Kaynakça" } };

    const source = storeCitationSource("tr", "References", "Empty", old);

    expect(source.title()).toBe("Kaynakça");
  });

  it("reports a failed read as an RPC error", async () => {
    backend.fail = true;

    await expect(readVersion(PATH, "1-save-0123456789abcdef")).rejects.toBeInstanceOf(RpcCallError);
  });
});

describe("restoreVersion", () => {
  it("keeps the current text as a version, then opens the old one as unsaved", async () => {
    backend.files.set("1-save-0123456789abcdef", serializeVersion(createDocument("Tez", paragraph("Eski giriş"))));
    useDocumentStore.getState().open(createDocument("Tez", paragraph("Yeni giriş")), PATH);
    const session = useDocumentStore.getState().session;

    const restored = await restoreVersion(PATH, "1-save-0123456789abcdef");

    const state = useDocumentStore.getState();
    expect(restored).toBe(true);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0]).toMatchObject({ path: PATH, kind: "restore" });
    expect(JSON.parse(backend.writes[0].contents).content).toEqual(paragraph("Yeni giriş"));
    expect(state.document?.content).toEqual(paragraph("Eski giriş"));
    expect(state).toMatchObject({ filePath: PATH, dirty: true, session: session + 1 });
  });

  it("leaves the document alone when the version is gone", async () => {
    useDocumentStore.getState().open(createDocument("Tez", paragraph("Yeni")), PATH);

    const restored = await restoreVersion(PATH, "9-save-0123456789abcdef");

    expect(restored).toBe(false);
    expect(backend.writes).toHaveLength(0);
    expect(useDocumentStore.getState()).toMatchObject({ dirty: false, document: { content: paragraph("Yeni") } });
  });
});

describe("useAutoVersions", () => {
  it("keeps one automatic version ten minutes after the first edit", () => {
    vi.useFakeTimers();
    useDocumentStore.getState().open(createDocument("Tez", paragraph("a")), PATH);
    renderHook(() => useAutoVersions());

    act(() => useDocumentStore.getState().setContent(paragraph("ab")));
    act(() => vi.advanceTimersByTime(AUTO_VERSION_MS / 2));
    act(() => useDocumentStore.getState().setContent(paragraph("abc")));
    act(() => vi.advanceTimersByTime(AUTO_VERSION_MS / 2));

    const autos = invoke.mock.calls.filter(([command]) => command === "document_versions_write");
    expect(autos).toHaveLength(1);
    expect(autos[0][1]).toMatchObject({ path: PATH, kind: "auto" });
    expect(JSON.parse((autos[0][1] as { contents: string }).contents).content).toEqual(paragraph("abc"));
  });

  it("keeps nothing for an untitled document or one saved in the meantime", () => {
    vi.useFakeTimers();
    useDocumentStore.getState().open(createDocument("Taslak", paragraph("a")));
    renderHook(() => useAutoVersions());

    act(() => useDocumentStore.getState().setContent(paragraph("ab")));
    act(() => vi.advanceTimersByTime(AUTO_VERSION_MS));
    act(() => useDocumentStore.getState().open(createDocument("Tez", paragraph("a")), PATH));
    act(() => useDocumentStore.getState().setContent(paragraph("ab")));
    act(() => useDocumentStore.getState().markSaved(PATH));
    act(() => vi.advanceTimersByTime(AUTO_VERSION_MS));

    expect(invoke.mock.calls.filter(([command]) => command === "document_versions_write")).toHaveLength(0);
  });
});

describe("version history dialog", () => {
  it("lists the current version first, previews an older one and restores it", async () => {
    backend.files.set("1-open-0123456789abcdef", serializeVersion(createDocument("Tez", paragraph("İlk taslak"))));
    backend.files.set("2-save-0123456789abcdef", serializeVersion(createDocument("Tez", paragraph("İkinci taslak"))));
    useDocumentStore.getState().open(createDocument("Tez", paragraph("Son hali")), PATH);
    const onClose = vi.fn();
    render(<VersionHistoryDialog open onClose={onClose} onSave={() => undefined} language="en" />);

    const rows = await screen.findAllByTestId("versions-item");
    expect(screen.getByTestId("versions-current").textContent).toContain("Current version");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Saved"), expect.stringContaining("When opened")]);
    await waitFor(() => expect(screen.getByTestId("version-preview-body").textContent).toBe("Son hali"));
    expect(screen.queryByTestId("versions-restore")).toBeNull();

    fireEvent.click(rows[1]);
    await waitFor(() => expect(screen.getByTestId("version-preview-body").textContent).toBe("İlk taslak"));
    fireEvent.click(screen.getByTestId("versions-restore"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useDocumentStore.getState().document?.content).toEqual(paragraph("İlk taslak"));
  });

  it("tells when the chosen version disappeared and refreshes the list", async () => {
    backend.files.set("1-open-0123456789abcdef", serializeVersion(createDocument("Tez", paragraph("İlk"))));
    useDocumentStore.getState().open(createDocument("Tez", paragraph("Son")), PATH);
    const onClose = vi.fn();
    render(<VersionHistoryDialog open onClose={onClose} onSave={() => undefined} language="en" />);
    fireEvent.click((await screen.findAllByTestId("versions-item"))[0]);
    await waitFor(() => expect(screen.getByTestId("version-preview-body").textContent).toBe("İlk"));
    backend.files.clear();

    fireEvent.click(screen.getByTestId("versions-restore"));

    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.message).toContain("no longer there"));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByTestId("versions-item")).toHaveLength(0));
    expect(useDocumentStore.getState().document?.content).toEqual(paragraph("Son"));
  });

  it("asks to save an untitled document first", () => {
    useDocumentStore.getState().open(createDocument("Taslak"));
    const onSave = vi.fn();
    render(<VersionHistoryDialog open onClose={() => undefined} onSave={onSave} language="en" />);

    fireEvent.click(screen.getByTestId("versions-save"));

    expect(screen.getByText("No versions yet")).toBeTruthy();
    expect(onSave).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows an error with a retry when the history cannot be read", async () => {
    backend.fail = true;
    useDocumentStore.getState().open(createDocument("Tez", paragraph("a")), PATH);
    render(<VersionHistoryDialog open onClose={() => undefined} onSave={() => undefined} language="en" />);

    expect(await screen.findByText("Version history could not be read")).toBeTruthy();
    backend.fail = false;
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));

    expect(await screen.findByTestId("versions-current")).toBeTruthy();
  });
});
