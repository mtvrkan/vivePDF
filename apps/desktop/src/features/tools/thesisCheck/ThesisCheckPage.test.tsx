import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import type { DocumentInfo, ThesisCheckItem, ThesisCheckParams, ThesisCheckReport } from "@/types";

const { checkThesis, getDocumentInfo } = vi.hoisted(() => ({ checkThesis: vi.fn(), getDocumentInfo: vi.fn() }));

vi.mock("@/shared/rpc/documents", () => ({ getDocumentInfo }));
vi.mock("@/shared/rpc/operations", async (original) => ({ ...(await original<typeof import("@/shared/rpc/operations")>()), checkThesis }));

const { ThesisCheckPage } = await import("./ThesisCheckPage");

const item = (id: string, status: ThesisCheckItem["status"], extra: Partial<ThesisCheckItem> = {}): ThesisCheckItem => ({ id, status, pages: [], pageTotal: 0, expected: null, found: null, ...extra });

const REPORT: ThesisCheckReport = {
  pageCount: 86,
  textPages: 86,
  ready: false,
  checks: [
    item("text", "pass"),
    item("marginLeft", "fail", { pages: [3, 12], pageTotal: 2, expected: "40.0", found: "29.9" }),
    item("bodyFont", "warn", { pages: [22], pageTotal: 1, expected: "Times New Roman", found: "Times New Roman" }),
    item("lineSpacing", "pass", { expected: "1.5", found: "18.0" }),
    item("pageNumberPlace", "skip", { expected: "any" }),
    item("pageNumberOrder", "pass"),
  ],
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/tools/thesis-check"]}>
      <ThesisCheckPage />
    </MemoryRouter>,
  );
  const handler = useDropTargetStore.getState().handler;
  if (!handler) throw new Error("thesis check page registered no drop handler");
  act(() => handler(["/Docs/thesis.pdf"]));
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  checkThesis.mockReset();
  getDocumentInfo.mockReset();
});

describe("ThesisCheckPage", () => {
  it("checks the dropped thesis with the left 4 cm rules and groups the findings", async () => {
    getDocumentInfo.mockResolvedValue({ pageCount: 86 } as DocumentInfo);
    checkThesis.mockResolvedValue(REPORT);
    renderPage();

    const report = await screen.findByText("Left margin");

    const params = checkThesis.mock.calls[0][0] as ThesisCheckParams;
    expect(params).toMatchObject({ path: "/Docs/thesis.pdf", paper: "a4", fontFamily: "Times New Roman", fontSize: 12, lineHeight: 1.5, pageNumbers: "center" });
    expect(params.marginsMm).toEqual({ top: 25, bottom: 25, left: 40, right: 25 });
    expect(report.closest("[data-thesis-check]")?.getAttribute("data-status")).toBe("fail");
    expect(screen.getByText("Expected 40.0 mm, narrowest 29.9 mm · 2 pages.")).toBeTruthy();
    expect(screen.getByText("Lines are 18.0 pt apart, which fits 1.5 line spacing.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Page layout" })).toBeTruthy();
    const result = document.querySelector("[data-thesis-result]") as HTMLElement;
    expect(within(result).getByText("Fix the red items before you submit")).toBeTruthy();
    expect(result.textContent).toContain("3 / 5");
  });

  it("switches to custom rules when a margin is edited and checks again", async () => {
    getDocumentInfo.mockResolvedValue({ pageCount: 86 } as DocumentInfo);
    checkThesis.mockResolvedValue(REPORT);
    renderPage();
    await screen.findByText("Left margin");

    fireEvent.change(document.querySelector("[data-thesis-margin=left]") as HTMLInputElement, { target: { value: "500" } });

    await waitFor(() => expect(checkThesis).toHaveBeenCalledTimes(2));
    expect((checkThesis.mock.calls[1][0] as ThesisCheckParams).marginsMm.left).toBe(100);
    expect(screen.getByRole("radio", { name: /Custom/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("points a scan without text to OCR", async () => {
    getDocumentInfo.mockResolvedValue({ pageCount: 4 } as DocumentInfo);
    checkThesis.mockRejectedValue({ code: "UNSUPPORTED", message: "no text", data: { reason: "noText" } });
    renderPage();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("This PDF has no text layer");
    expect(within(alert).getByRole("link", { name: /Open the OCR tool/ }).getAttribute("href")).toBe("/tools/ocr");
    expect(document.querySelector("[data-thesis-report]")).toBeNull();
  });

  it("lists what was expected and found on each page, with the page's note and heading", async () => {
    getDocumentInfo.mockResolvedValue({ pageCount: 86 } as DocumentInfo);
    checkThesis.mockResolvedValue({
      ...REPORT,
      checks: [
        item("marginLeft", "fail", { pages: [3], pageTotal: 450, expected: "40.0", found: "29.9", details: [{ page: 3, expected: "40.0", found: "29.9", note: "landscape", text: null }] }),
        item("headings", "warn", { pages: [14], pageTotal: 1, details: [{ page: 14, expected: "Times New Roman|14|bold", found: "Arial|12|regular", note: "level1", text: "2. YÖNTEM" }] }),
        item("pageNumbers", "warn", { pages: [9], pageTotal: 1, details: [{ page: 9, expected: "4", found: null, note: null, text: null }] }),
      ],
    });
    renderPage();
    await screen.findByText("Left margin");

    for (const toggle of document.querySelectorAll<HTMLButtonElement>("[data-thesis-details-toggle]")) fireEvent.click(toggle);

    const margin = document.querySelector("[data-thesis-check=marginLeft] [data-thesis-detail-page='3']") as HTMLElement;
    expect(margin.textContent).toContain("Expected: 40.0 mm · Found: 29.9 mm");
    expect(margin.textContent).toContain("Landscape page");
    expect(screen.getByText("The first 1 of 450 pages are listed.")).toBeTruthy();
    const heading = document.querySelector("[data-thesis-detail-page='14']") as HTMLElement;
    expect(heading.textContent).toContain("Expected: Times New Roman, 14 pt, bold · Found: Arial, 12 pt, regular");
    expect(heading.textContent).toContain("Level 1 heading");
    expect(heading.textContent).toContain("“2. YÖNTEM”");
    expect((document.querySelector("[data-thesis-detail-page='9']") as HTMLElement).textContent).toContain("Expected: 4 · Found: none");
  });

  it("asks for an eye check when the font names cannot be read", async () => {
    getDocumentInfo.mockResolvedValue({ pageCount: 86 } as DocumentInfo);
    checkThesis.mockResolvedValue({ ...REPORT, checks: [item("bodyFont", "warn", { expected: "Times New Roman", reason: "unknownFont" })] });
    renderPage();

    expect(await screen.findByText("The font names could not be read from the PDF; check by eye that the text is set in Times New Roman.")).toBeTruthy();
    expect(document.querySelector("[data-thesis-details-toggle]")).toBeNull();
  });
});
