import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useOpenStore } from "@/shared/store/openStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { axeViolations } from "@/test/axe";
import { RecentDocuments } from "./RecentDocuments";

const pickAndOpen = vi.fn(() => Promise.resolve());
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@/features/viewer/useOpenPdf", () => ({
  useOpenPdf: () => ({ pickAndOpen, openPath: vi.fn() }),
}));

beforeAll(async () => {
  await ready();
  await setLocale("en");
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  pickAndOpen.mockClear();
  invoke.mockReset();
  invoke.mockRejectedValue(new Error("unavailable"));
  useRecentStore.setState({ items: [], sort: "recent" });
  useOpenStore.setState({ busy: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecentDocuments", () => {
  it("offers to open a PDF from the empty state", async () => {
    const { container } = render(<RecentDocuments />);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));

    expect(pickAndOpen).toHaveBeenCalledOnce();
  });

  it("disables the empty-state button while a file is opening", () => {
    useOpenStore.setState({ busy: true });

    render(<RecentDocuments />);

    expect((screen.getByRole("button", { name: "Open PDF" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the empty state once a document is listed", () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
    useRecentStore.setState({ items: [{ path: "C:/Docs/report.pdf", fileName: "report.pdf", openedAt: Date.now() }] });

    render(<RecentDocuments />);

    expect(screen.queryByRole("button", { name: "Open PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "report.pdf" }).title).toBe("C:/Docs/report.pdf");
  });

  it("lists documents as compact rows without previews when small", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/report.pdf", fileName: "report.pdf", openedAt: Date.now() }, { path: "C:/Docs/plan.pdf", fileName: "plan.pdf", openedAt: Date.now() }] });

    render(<RecentDocuments size="small" />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove plan.pdf from recent" }));
    expect(useRecentStore.getState().items.map((item) => item.fileName)).toEqual(["report.pdf"]);
  });

  it("dims a missing document, disables opening it and keeps a remove action", async () => {
    invoke.mockResolvedValue([false, true]);
    useRecentStore.setState({ items: [{ path: "C:/Docs/gone.pdf", fileName: "gone.pdf", openedAt: Date.now() }, { path: "C:/Docs/here.pdf", fileName: "here.pdf", openedAt: Date.now() }] });

    render(<RecentDocuments size="small" />);

    await waitFor(() => expect((screen.getByRole("button", { name: "gone.pdf" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText("File not found")).toBeTruthy();
    expect((screen.getByRole("button", { name: "here.pdf" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove gone.pdf from recent" }));
    expect(useRecentStore.getState().items.map((item) => item.fileName)).toEqual(["here.pdf"]);
  });

  it("filters by file name and by folder, ignoring case and accents", () => {
    useRecentStore.setState({ items: [
      { path: "C:/Müşteri/özet.pdf", fileName: "özet.pdf", openedAt: 3 },
      { path: "C:/Work/invoice.pdf", fileName: "invoice.pdf", openedAt: 2 },
      { path: "C:/Home/notes.pdf", fileName: "notes.pdf", openedAt: 1 },
    ] });
    render(<RecentDocuments size="small" />);
    const search = screen.getByRole("textbox", { name: "Search recent documents" });

    fireEvent.change(search, { target: { value: "OZET" } });
    const byName = screen.getAllByRole("listitem").map((item) => item.textContent);
    fireEvent.change(search, { target: { value: "work" } });
    const byFolder = screen.getAllByRole("listitem").map((item) => item.textContent);

    expect(byName).toHaveLength(1);
    expect(byName[0]).toContain("özet.pdf");
    expect(byFolder).toHaveLength(1);
    expect(byFolder[0]).toContain("invoice.pdf");
  });

  it("says nothing matches instead of showing the empty state", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/report.pdf", fileName: "report.pdf", openedAt: 2 }, { path: "C:/Docs/plan.pdf", fileName: "plan.pdf", openedAt: 1 }] });
    render(<RecentDocuments size="small" />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search recent documents" }), { target: { value: "budget" } });

    expect(screen.getByRole("status").textContent).toBe("No recent documents match “budget”.");
    expect(screen.queryByRole("button", { name: "Open PDF" })).toBeNull();
  });

  it("sorts by name when chosen from the sort menu and remembers it", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/zeta.pdf", fileName: "zeta.pdf", openedAt: 2 }, { path: "C:/Docs/alpha.pdf", fileName: "alpha.pdf", openedAt: 1 }] });
    render(<RecentDocuments size="small" />);

    fireEvent.click(screen.getByRole("combobox", { name: "Sort recent documents" }));
    fireEvent.click(screen.getByRole("option", { name: "Name (A–Z)" }));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent?.match(/^\w+\.pdf/)?.[0])).toEqual(["alpha.pdf", "zeta.pdf"]);
    expect(useRecentStore.getState().sort).toBe("name");
  });

  it("shows pinned documents first under their own label", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/new.pdf", fileName: "new.pdf", openedAt: 2 }, { path: "C:/Docs/old.pdf", fileName: "old.pdf", openedAt: 1, pinned: true }] });

    render(<RecentDocuments size="small" />);

    const pinnedList = screen.getByRole("list", { name: "Pinned" });
    expect(pinnedList.textContent).toContain("old.pdf");
    expect(screen.getAllByRole("listitem")[0]?.textContent).toContain("old.pdf");
    expect(screen.getByRole("list", { name: "Other documents" }).textContent).toContain("new.pdf");
  });

  it("pins and unpins a document from its pin button", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/report.pdf", fileName: "report.pdf", openedAt: 2 }, { path: "C:/Docs/plan.pdf", fileName: "plan.pdf", openedAt: 1 }] });
    render(<RecentDocuments size="small" />);

    fireEvent.click(screen.getByRole("button", { name: "Pin plan.pdf" }));
    const afterPin = useRecentStore.getState().items.find((item) => item.fileName === "plan.pdf")?.pinned;
    fireEvent.click(screen.getByRole("button", { name: "Unpin plan.pdf" }));
    const afterUnpin = useRecentStore.getState().items.find((item) => item.fileName === "plan.pdf")?.pinned;

    expect(afterPin).toBe(true);
    expect(afterUnpin).toBe(false);
  });

  it("keeps pinned documents when the list is cleared", () => {
    useRecentStore.setState({ items: [{ path: "C:/Docs/report.pdf", fileName: "report.pdf", openedAt: 2 }, { path: "C:/Docs/plan.pdf", fileName: "plan.pdf", openedAt: 1, pinned: true }] });
    render(<RecentDocuments size="small" />);

    fireEvent.click(screen.getByRole("button", { name: "Clear unpinned" }));

    expect(useRecentStore.getState().items.map((item) => item.fileName)).toEqual(["plan.pdf"]);
  });

  it("limits the filtered list and offers to show all of it", () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
    useRecentStore.setState({ items: Array.from({ length: 6 }, (_, index) => ({ path: `C:/Docs/report-${index}.pdf`, fileName: `report-${index}.pdf`, openedAt: index })).concat({ path: "C:/Docs/plan.pdf", fileName: "plan.pdf", openedAt: 9 }) });
    render(<RecentDocuments size="small" />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search recent documents" }), { target: { value: "report" } });
    const limited = screen.getAllByRole("listitem").length;
    fireEvent.click(screen.getByRole("button", { name: "Show all · 6" }));

    expect(limited).toBe(4);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});
