import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { listFormFields } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import type { FieldsResult, FormField } from "@/types";
import { useFormFillStore } from "./formFillStore";
import { FormXfaNotice } from "./FormXfaNotice";

vi.mock("@/shared/rpc/operations", () => ({ listFormFields: vi.fn() }));

const DOCUMENT_ID = "doc-xfa";

async function renderNotice(hasForms: boolean, result: FieldsResult) {
  vi.mocked(listFormFields).mockResolvedValue(result);
  useDocumentStore.setState((state) => ({
    documents: { ...state.documents, [DOCUMENT_ID]: { ...state.documents[DOCUMENT_ID], info: { hasForms, pageSizes: [] } as never } },
  }));
  render(<FormXfaNotice documentId={DOCUMENT_ID} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(listFormFields).mockReset();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/xfa.pdf", null);
  useFormFillStore.setState({ loads: {}, values: {} });
});

afterEach(cleanup);

describe("FormXfaNotice", () => {
  it("tells that an XFA-only form is filled in the Forms tool", async () => {
    await renderNotice(true, { fields: [], isForm: true, xfa: true, boxes: [] });

    expect(screen.getByRole("status").textContent).toContain("XFA");
  });

  it("stays hidden when the XFA form also has fillable fields", async () => {
    const text: FormField = { name: "a", kind: "text", page: 1, value: null, options: [], label: null, readOnly: false, required: false, multiline: false, rect: [0, 0, 1, 1] };

    await renderNotice(true, { fields: [text], isForm: true, xfa: true, boxes: [] });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not ask the engine about documents without forms", async () => {
    await renderNotice(false, { fields: [], isForm: false, xfa: false, boxes: [] });

    expect(listFormFields).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
