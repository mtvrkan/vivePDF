import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { RpcCallError } from "@/shared/rpc/client";
import type { ExportSource } from "./organizerExport";

vi.mock("@/shared/rpc/operations", () => ({ convertToImages: vi.fn() }));
vi.mock("@/shared/rpc/files", () => ({ deleteFile: vi.fn(async () => undefined), openProducedFile: vi.fn(async () => undefined) }));

const { ExportImagesDialog } = await import("./ExportImagesDialog");
const { convertToImages } = await import("@/shared/rpc/operations");
const { deleteFile } = await import("@/shared/rpc/files");

const temporary: ExportSource = { path: "C:/tmp/vivepdf-pages-1.pdf", password: "pw", pages: null, pageCount: 3, temporary: true };

function renderDialog(prepare: () => Promise<ExportSource> = vi.fn(async () => temporary)) {
  render(<ExportImagesDialog open count={3} documentPath="C:/docs/report.pdf" defaultDir="C:/docs" prepare={prepare} onClose={vi.fn()} />, { wrapper: MemoryRouter });
  return prepare;
}

async function save(name = "Save pictures") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(convertToImages).mockReset();
  vi.mocked(deleteFile).mockClear();
});

afterEach(cleanup);

describe("ExportImagesDialog", () => {
  it("renders the arranged copy as pictures named after the document and then deletes the copy", async () => {
    vi.mocked(convertToImages).mockResolvedValue({ outputs: ["C:/docs/report-1.png", "C:/docs/report-2.png", "C:/docs/report-3.png"], bytes: 30, reducedPages: [], pageCount: 3 });
    renderDialog();

    await save();

    expect(vi.mocked(convertToImages).mock.calls[0][0]).toMatchObject({ path: temporary.path, password: "pw", outputDir: "C:/docs", format: "png", dpi: 150, baseName: "report" });
    expect(vi.mocked(convertToImages).mock.calls[0][0].pages).toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith(temporary.path);
    expect(screen.getByText("3 pictures saved.")).toBeTruthy();
  });

  it("passes the page list when the open file is used as it is", async () => {
    vi.mocked(convertToImages).mockResolvedValue({ outputs: ["C:/docs/report-2.png"], bytes: 10, reducedPages: [], pageCount: 1 });
    renderDialog(vi.fn(async () => ({ path: "C:/docs/report.pdf", password: null, pages: "2", pageCount: 1, temporary: false })));

    await save();

    expect(vi.mocked(convertToImages).mock.calls[0][0]).toMatchObject({ path: "C:/docs/report.pdf", pages: "2" });
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("asks before replacing pictures that already exist and retries with overwrite", async () => {
    vi.mocked(convertToImages)
      .mockRejectedValueOnce(new RpcCallError({ code: "INVALID_PARAMS", message: "exists", data: { exists: true, path: "C:/docs/report-1.png" } }))
      .mockResolvedValueOnce({ outputs: ["C:/docs/report-1.png"], bytes: 10, reducedPages: [], pageCount: 1 });
    renderDialog();

    await save();
    expect(screen.getByText("Pictures with these names are already in the folder.")).toBeTruthy();
    await save("Replace them");

    expect(vi.mocked(convertToImages).mock.calls[1][0]).toMatchObject({ overwrite: true });
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });
});
