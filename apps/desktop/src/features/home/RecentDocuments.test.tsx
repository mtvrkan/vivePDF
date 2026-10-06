import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useOpenStore } from "@/shared/store/openStore";
import { useRecentStore } from "@/shared/store/recentStore";
import { axeViolations } from "@/test/axe";
import { RecentDocuments } from "./RecentDocuments";

const pickAndOpen = vi.fn(() => Promise.resolve());

vi.mock("@/features/viewer/useOpenPdf", () => ({
  useOpenPdf: () => ({ pickAndOpen, openPath: vi.fn() }),
}));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  pickAndOpen.mockClear();
  useRecentStore.setState({ items: [] });
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
    fireEvent.click(screen.getByRole("button", { name: "Close: plan.pdf" }));
    expect(useRecentStore.getState().items.map((item) => item.fileName)).toEqual(["report.pdf"]);
  });
});

