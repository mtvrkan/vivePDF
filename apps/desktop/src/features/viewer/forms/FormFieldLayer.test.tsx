import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { listFormFields } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { FieldsResult, FormField } from "@/types";
import { useFormFillStore } from "./formFillStore";
import { FormFieldLayer } from "./FormFieldLayer";
import { widgetsOnPage } from "./formWidgets";

vi.mock("@/shared/rpc/operations", () => ({ listFormFields: vi.fn() }));

const DOCUMENT_ID = "doc-form";

function field(name: string, kind: FormField["kind"], rect: number[], extra: Partial<FormField> = {}): FormField {
  return { name, kind, page: 1, value: null, options: [], label: null, readOnly: false, required: false, multiline: false, rect, visibleRect: rect, ...extra };
}

const FIELDS: FormField[] = [
  field("fullName", "text", [50, 50, 250, 70], { label: "Full name", value: "Ada" }),
  field("notes", "text", [50, 300, 250, 360], { multiline: true }),
  field("agree", "checkbox", [50, 100, 64, 114], { widgets: [{ page: 1, visibleRect: [50, 100, 64, 114], state: "Yes" }] }),
  field("size", "radio", [50, 140, 64, 154], {
    options: ["S", "L"],
    optionLabels: ["Small", "Large"],
    value: "S",
    widgets: [
      { page: 1, visibleRect: [50, 140, 64, 154], state: "S" },
      { page: 1, visibleRect: [80, 140, 94, 154], state: "L" },
    ],
  }),
  field("country", "combobox", [50, 180, 250, 200], { options: ["tr", "de"], optionLabels: ["Türkiye", "Almanya"] }),
  field("langs", "listbox", [50, 220, 250, 280], { options: ["en", "tr"], multiSelect: true }),
  field("code", "text", [50, 400, 250, 420], { readOnly: true }),
  field("sig", "signature", [50, 500, 250, 540]),
];

async function renderLayer(fields: FormField[] = FIELDS) {
  vi.mocked(listFormFields).mockResolvedValue({ fields, isForm: true, xfa: false, boxes: [] } satisfies FieldsResult);
  useDocumentStore.setState((state) => ({
    documents: { ...state.documents, [DOCUMENT_ID]: { ...state.documents[DOCUMENT_ID], info: { hasForms: true, pageSizes: [{ width: 600, height: 800, rotation: 0 }] } as never } },
  }));
  render(<FormFieldLayer documentId={DOCUMENT_ID} pageIndex={0} width={600} height={800} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function pendingForms() {
  return (usePendingChangesStore.getState().changes[DOCUMENT_ID] ?? []).filter((change) => change.kind === "formFilled");
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  vi.mocked(listFormFields).mockReset();
  useDocumentStore.setState({ documents: {}, order: [], activeId: null });
  useDocumentStore.getState().register(DOCUMENT_ID, "C:/belgeler/form.pdf", null);
  usePendingChangesStore.setState({ changes: {} });
  useFormFillStore.setState({ loads: {}, values: {} });
  useViewerOverlayStore.setState({ mode: null });
});

afterEach(cleanup);

describe("FormFieldLayer", () => {
  it("renders the control that matches each field kind and skips signatures", async () => {
    await renderLayer();

    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveProperty("tagName", "INPUT");
    expect(screen.getByRole("textbox", { name: "notes" })).toHaveProperty("tagName", "TEXTAREA");
    expect(screen.getByRole("checkbox", { name: "agree" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: "country" })).toHaveProperty("tagName", "SELECT");
    expect(screen.getByRole("listbox", { name: "langs" })).toHaveProperty("multiple", true);
    expect(document.querySelector('[data-form-field="sig"]')).toBeNull();
  });

  it("disables read-only fields", async () => {
    await renderLayer();

    expect(screen.getByRole("textbox", { name: "code" })).toHaveProperty("disabled", true);
  });

  it("keeps a single formFilled change holding every changed value", async () => {
    await renderLayer();

    fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), { target: { value: "Ada Lovelace" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "agree" }));

    const pending = pendingForms();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ values: { fullName: "Ada Lovelace", agree: true }, label: "Form fields" });
  });

  it("lets only one radio of a group be chosen", async () => {
    await renderLayer();

    fireEvent.click(screen.getByRole("radio", { name: "size: Large" }));

    expect(screen.getByRole("radio", { name: "size: Large" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "size: Small" })).toHaveProperty("checked", false);
    expect(pendingForms()[0]).toMatchObject({ values: { size: "L" } });
  });

  it("drops the change and the typed values when the pending change is discarded", async () => {
    await renderLayer();
    const input = screen.getByRole("textbox", { name: "Full name" });
    fireEvent.change(input, { target: { value: "Grace" } });

    act(() => usePendingChangesStore.getState().clear(DOCUMENT_ID));

    expect(useFormFillStore.getState().values[DOCUMENT_ID]).toBeUndefined();
    expect(input).toHaveProperty("value", "Ada");
  });

  it("removes the pending change when a value is set back to the original", async () => {
    await renderLayer();
    const input = screen.getByRole("textbox", { name: "Full name" });

    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.change(input, { target: { value: "Ada" } });

    expect(pendingForms()).toHaveLength(0);
  });

  it("hides itself while the page editor overlay is active", async () => {
    useViewerOverlayStore.setState({ mode: "edit" as never });

    await renderLayer();

    expect(document.querySelector("[data-form-fields]")).toBeNull();
  });
});

describe("widgetsOnPage", () => {
  it("orders the widgets of a page top to bottom, then left to right", () => {
    const placed = widgetsOnPage(FIELDS, 1).map((widget) => widget.key);

    expect(placed.slice(0, 4)).toEqual(["fullName-0", "agree-0", "size-0", "size-1"]);
  });

  it("returns nothing for a page without fields", () => {
    expect(widgetsOnPage(FIELDS, 2)).toEqual([]);
  });
});
