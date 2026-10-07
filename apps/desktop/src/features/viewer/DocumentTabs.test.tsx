import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "@/shared/store/documentStore";
import { DocumentTabs } from "./DocumentTabs";
import { useTabGroupStore } from "./tabGroups";

const activate = vi.fn();
let activeDocumentId = "a";

vi.mock("@embedpdf/plugin-document-manager/react", () => ({
  useActiveDocument: () => ({ activeDocumentId }),
  useOpenDocuments: () => ["a", "b", "c"].map((id) => ({ id, name: `${id}.pdf` })),
}));
vi.mock("./useOpenPdf", () => ({
  useOpenPdf: () => ({ activate, closeDocument: vi.fn(), pickAndOpen: vi.fn(), openPath: vi.fn() }),
}));
vi.mock("./useCloseDocuments", () => ({
  useCloseDocuments: () => ({ closeDocuments: vi.fn(), hasUnsavedWork: () => false }),
}));
vi.mock("./useDocumentWindow", () => ({ useDocumentWindow: () => vi.fn() }));
vi.mock("./ThumbnailSidebar", () => ({ PAGE_DRAG_TYPE: "application/x-vivepdf-page" }));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  activate.mockReset();
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
