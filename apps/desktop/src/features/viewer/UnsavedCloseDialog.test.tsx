import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useCloseRequestStore } from "@/shared/store/closeRequestStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { axeViolations } from "@/test/axe";

const mocks = vi.hoisted(() => ({ save: vi.fn(), closeDocument: vi.fn() }));
vi.mock("./useDocumentSave", () => ({ useDocumentSave: () => ({ save: mocks.save }) }));
vi.mock("./useOpenPdf", () => ({ useOpenPdf: () => ({ closeDocument: mocks.closeDocument }) }));

import { UnsavedCloseDialog } from "./UnsavedCloseDialog";

const DOCUMENT_ID = "doc-unsaved";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  mocks.save.mockReset();
  mocks.closeDocument.mockReset();
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/docs/Report draft.pdf", null);
  useCloseRequestStore.setState({ queue: [DOCUMENT_ID] });
});

afterEach(() => {
  cleanup();
  useCloseRequestStore.setState({ queue: [] });
  useDocumentStore.getState().remove(DOCUMENT_ID);
});

describe("UnsavedCloseDialog", () => {
  it("names the file in bold inside the sentence and passes an accessibility check", async () => {
    const { container } = render(<UnsavedCloseDialog />);

    const name = screen.getByText("Report draft.pdf");

    expect(name.tagName).toBe("SPAN");
    expect(name.parentElement?.textContent).toBe("Report draft.pdf has annotations or changes that are not saved yet.");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("closes without saving and moves to the next document", () => {
    render(<UnsavedCloseDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));

    expect(mocks.closeDocument).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(useCloseRequestStore.getState().queue).toEqual([]);
  });

  it("keeps the document open when saving fails", async () => {
    mocks.save.mockResolvedValue(false);
    render(<UnsavedCloseDialog />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and close" }));
    });

    expect(mocks.closeDocument).not.toHaveBeenCalled();
    expect(useCloseRequestStore.getState().queue).toEqual([DOCUMENT_ID]);
  });
});
