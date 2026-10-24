import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";

vi.mock("@/shared/rpc/operations", async (original) => ({
  ...(await original<typeof import("@/shared/rpc/operations")>()),
  toolsStatus: () => Promise.resolve({ libreoffice: "/Applications/LibreOffice.app", ocrLanguages: [] }),
}));
vi.mock("@/shared/lib/pathKinds", () => ({ pathKinds: (paths: string[]) => Promise.resolve(paths.map(() => "file")) }));
vi.mock("./runConversion", () => ({
  runConversion: () => Promise.resolve({ outputs: ["/Docs/agreement.pdf"], bytes: 2048, count: 1, label: "pages" }),
}));

const { ConvertPage } = await import("./ConvertPage");

function renderAt(mode: string) {
  render(
    <MemoryRouter initialEntries={[`/tools/convert?mode=${mode}`]}>
      <ConvertPage />
    </MemoryRouter>,
  );
}

function drop(paths: string[]) {
  const handler = useDropTargetStore.getState().handler;
  if (!handler) throw new Error("convert page registered no drop handler");
  act(() => handler(paths));
}

const outputValue = () => (screen.getByRole("textbox", { name: "Output file" }) as HTMLInputElement).value;

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("ConvertPage switching modes", () => {
  it("does not carry the Office output name over to Images → PDF", async () => {
    renderAt("file-to-pdf");
    drop(["/Docs/agreement.docx"]);
    await waitFor(() => expect(outputValue()).toBe("agreement.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "Images → PDF" }));
    drop(["/Docs/photo-1.png"]);

    await waitFor(() => expect(outputValue()).toBe("album.pdf"));
  });
});

describe("ConvertPage result summary", () => {
  it("names a single page in the singular", async () => {
    renderAt("file-to-pdf");
    drop(["/Docs/agreement.docx"]);
    await waitFor(() => expect(outputValue()).toBe("agreement.pdf"));

    fireEvent.click(screen.getAllByRole("button", { name: "Convert" })[0]);

    expect(await screen.findByText(/^page · /)).toBeTruthy();
  });
});
