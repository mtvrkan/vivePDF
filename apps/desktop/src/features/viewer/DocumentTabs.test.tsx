import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { splitViewOf, useSplitViewStore } from "@/shared/store/splitViewStore";
import { DocumentTabs } from "./DocumentTabs";
import { useTabGroupStore } from "./tabGroups";

const activate = vi.fn();
const closeDocument = vi.fn((id: string) => useDocumentStore.getState().remove(id));
const openWindow = vi.fn();
const dropTabsOnWindow = vi.fn();
const closeWindow = vi.fn();
let mainWindow = true;
let activeDocumentId = "a";

vi.mock("@embedpdf/plugin-document-manager/react", () => ({
  useActiveDocument: () => ({ activeDocumentId }),
  useOpenDocuments: () => ["a", "b", "c"].map((id) => ({ id, name: `${id}.pdf` })),
}));
vi.mock("./useOpenPdf", () => ({
  useOpenPdf: () => ({ activate, closeDocument, pickAndOpen: vi.fn(), openPath: vi.fn() }),
}));
vi.mock("./useCloseDocuments", () => ({
  useCloseDocuments: () => ({ closeDocuments: vi.fn(), hasUnsavedWork: () => false }),
}));
vi.mock("./useDocumentWindow", () => ({ useDocumentWindow: () => openWindow }));
vi.mock("@/shared/rpc/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/rpc/files")>()),
  dropTabsOnWindow: (...args: unknown[]) => dropTabsOnWindow(...args),
}));
vi.mock("@/shared/lib/windowRole", () => ({ isMainWindow: () => mainWindow }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: closeWindow }) }));
vi.mock("./ThumbnailSidebar", () => ({ PAGE_DRAG_TYPE: "application/x-vivepdf-page" }));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  activate.mockReset();
  closeDocument.mockClear();
  openWindow.mockReset();
  dropTabsOnWindow.mockReset();
  closeWindow.mockReset();
  mainWindow = true;
  activeDocumentId = "a";
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  for (const id of ["a", "b", "c"]) useDocumentStore.getState().register(id, `/tmp/${id}.pdf`, null);
  useTabGroupStore.setState({ groups: [], memberOf: {} });
});

afterEach(cleanup);

describe("DocumentTabs keyboard navigation", () => {
  it("activates the next visible tab with ArrowRight", () => {
    render(<DocumentTabs />);

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowRight" });

    expect(activate).toHaveBeenCalledWith("b");
  });

  it("skips tabs hidden in a collapsed group instead of drifting by index", () => {
    const groupId = useTabGroupStore.getState().create(["b"]);
    useTabGroupStore.getState().setCollapsed(groupId, true);
    render(<DocumentTabs />);

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowRight" });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith("c");
  });

  it("End jumps to the last visible tab", () => {
    const groupId = useTabGroupStore.getState().create(["c"]);
    useTabGroupStore.getState().setCollapsed(groupId, true);
    render(<DocumentTabs />);

    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "End" });

    expect(activate).toHaveBeenCalledWith("b");
  });
});

describe("DocumentTabs split entry", () => {
  it("opens a background tab beside the active document", () => {
    useSplitViewStore.setState({ views: {}, revisions: {}, lastLayout: "rows" });
    render(<DocumentTabs />);

    fireEvent.contextMenu(screen.getAllByRole("tab")[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open beside current document" }));

    expect(splitViewOf(useSplitViewStore.getState(), "/tmp/a.pdf")).toMatchObject({ layout: "rows", secondary: { path: "/tmp/b.pdf", password: null } });
  });

  it("does not offer it on the active tab", () => {
    render(<DocumentTabs />);

    fireEvent.contextMenu(screen.getAllByRole("tab")[0]);

    expect(screen.queryByRole("menuitem", { name: "Open beside current document" })).toBeNull();
  });
});

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  Object.assign(event, { pointerId: 1, isPrimary: true });
  act(() => {
    target.dispatchEvent(event);
  });
}

function dragOut(tab: Element) {
  fireEvent.pointerDown(tab, { button: 0, isPrimary: true, pointerId: 1, clientX: 50, clientY: 10 });
  pointer(tab, "pointermove", 60, 40);
  pointer(tab, "pointerup", 1400, 300);
}

describe("DocumentTabs moving tabs between windows", () => {
  beforeEach(() => {
    let captured = false;
    HTMLElement.prototype.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => captured);
    HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    Object.assign(window, { innerWidth: 1000, innerHeight: 700 });
  });

  it("hands a tab dropped on another window to that window instead of opening a new one", async () => {
    dropTabsOnWindow.mockResolvedValue("doc-1");
    render(<DocumentTabs />);

    dragOut(screen.getAllByRole("tab")[1]);

    await waitFor(() => expect(closeDocument).toHaveBeenCalledWith("b"));
    expect(dropTabsOnWindow).toHaveBeenCalledWith(["/tmp/b.pdf"], null);
    expect(openWindow).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when no window is under the drop, and keeps the tab if that fails", async () => {
    dropTabsOnWindow.mockResolvedValue(null);
    openWindow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<DocumentTabs />);

    dragOut(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(closeDocument).toHaveBeenCalledWith("b"));
    dragOut(screen.getAllByRole("tab")[0]);
    await waitFor(() => expect(openWindow).toHaveBeenCalledTimes(2));

    expect(openWindow).toHaveBeenCalledWith(["/tmp/b.pdf"], true);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it("moves a tab from its menu into a centred new window without looking for a drop target", async () => {
    openWindow.mockResolvedValue(true);
    render(<DocumentTabs />);

    fireEvent.contextMenu(screen.getAllByRole("tab")[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to new window" }));

    await waitFor(() => expect(closeDocument).toHaveBeenCalledWith("b"));
    expect(openWindow).toHaveBeenCalledWith(["/tmp/b.pdf"], false);
    expect(dropTabsOnWindow).not.toHaveBeenCalled();
  });

  it("closes a document window once its last tab has moved away, never the main window", async () => {
    mainWindow = false;
    useDocumentStore.setState({ documents: {}, order: [], activeId: null });
    useDocumentStore.getState().register("a", "/tmp/a.pdf", null);
    dropTabsOnWindow.mockResolvedValue("main");
    render(<DocumentTabs />);

    dragOut(screen.getByRole("tab"));

    await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
  });

  it("moves a whole group with its name and colour when its chip is dragged out", async () => {
    const groupId = useTabGroupStore.getState().create(["b", "c"]);
    useTabGroupStore.getState().rename(groupId, "Contracts");
    useTabGroupStore.getState().recolor(groupId, "teal");
    dropTabsOnWindow.mockResolvedValue("doc-1");
    document.elementFromPoint = () => null;
    render(<DocumentTabs />);
    const chip = screen.getByRole("button", { name: /Contracts/ });

    fireEvent.pointerDown(chip, { button: 0, pointerId: 1, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 90, clientY: 10 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 1400, clientY: 300 });

    await waitFor(() => expect(closeDocument).toHaveBeenCalledTimes(2));
    expect(dropTabsOnWindow).toHaveBeenCalledWith(["/tmp/b.pdf", "/tmp/c.pdf"], { name: "Contracts", color: "teal", collapsed: false });
  });
});
