import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useTabGroupStore } from "./tabGroups";
import type { LaunchRequest } from "@/types";
import { FileOpenListener } from "./FileOpenListener";

const { launchRequest, openPaths } = vi.hoisted(() => ({
  launchRequest: vi.fn<() => Promise<LaunchRequest>>(),
  openPaths: vi.fn<(paths: string[]) => Promise<void>>(),
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "doc-1" }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: () => Promise.resolve(() => undefined) }) }));
vi.mock("@/shared/lib/windowRole", () => ({ isMainWindow: () => false }));
vi.mock("./useDocumentWindow", () => ({ useDocumentWindow: () => vi.fn() }));
vi.mock("./useOpenPdf", () => ({ useOpenPdf: () => ({ openPaths, pickAndOpen: vi.fn(), openClipboard: vi.fn() }) }));
vi.mock("@/shared/rpc/files", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/shared/rpc/files")>()), launchRequest }));

describe("FileOpenListener", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {}, order: [], activeId: null });
    useTabGroupStore.setState({ groups: [], memberOf: {} });
    openPaths.mockReset().mockImplementation(async (paths) => {
      paths.forEach((path, index) => useDocumentStore.getState().register(`id-${index}`, path, null));
    });
  });

  it("puts the documents a new window was opened with back into their tab group", async () => {
    launchRequest.mockResolvedValue({ tool: null, paths: ["/tmp/a.pdf", "/tmp/b.pdf"], group: { name: "Pack", color: "teal", collapsed: true } });

    render(<FileOpenListener />);

    await waitFor(() => expect(useTabGroupStore.getState().groups).toHaveLength(1));
    const [group] = useTabGroupStore.getState().groups;
    expect(group).toMatchObject({ name: "Pack", color: "teal", collapsed: true });
    expect(useTabGroupStore.getState().memberOf).toEqual({ "id-0": group?.id, "id-1": group?.id });
  });

  it("opens the documents as loose tabs when the request has no group", async () => {
    launchRequest.mockResolvedValue({ tool: null, paths: ["/tmp/a.pdf"] });

    render(<FileOpenListener />);

    await waitFor(() => expect(openPaths).toHaveBeenCalledWith(["/tmp/a.pdf"]));
    await Promise.resolve();
    expect(useTabGroupStore.getState().groups).toEqual([]);
  });

  it("opens nothing and makes no group when the request holds no openable file", async () => {
    launchRequest.mockResolvedValue({ tool: null, paths: ["/tmp/notes.xyz"], group: { name: "Pack", color: "teal", collapsed: false } });

    render(<FileOpenListener />);

    await waitFor(() => expect(launchRequest).toHaveBeenCalled());
    await Promise.resolve();
    expect(openPaths).not.toHaveBeenCalled();
    expect(useTabGroupStore.getState().groups).toEqual([]);
  });
});
