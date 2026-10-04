import { beforeEach, describe, expect, it, vi } from "vitest";

const previewFormData = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({ previewFormData: (...args: unknown[]) => previewFormData(...args) }));

import type { StudioTextElement } from "@/types/studio";
import { createDesign, createQr, createText, fillPlaceholders } from "../model/design";
import { addElements } from "../model/edit";
import { currentPage, useStudioStore } from "../design/studioStore";
import { textEditorBridge } from "../design/textEditorBridge";
import { PREVIEW_ROWS, previewValues, useMergeStore } from "./mergeStore";
import { insertPlaceholder } from "./placeholders";

const TABLE = { columns: ["Name", "Course"], rows: [{ Name: "Ayşe", Course: "Design" }, { Name: "Can", Course: "Print" }], totalRows: 2, sheets: [] };

function openWith(...elements: Parameters<typeof addElements>[1]) {
  const design = createDesign("Merge", 400, 300);
  useStudioStore.getState().open({ ...design, pages: [addElements(design.pages[0], elements)] });
}

function elements() {
  return currentPage(useStudioStore.getState())?.elements ?? [];
}

describe("fillPlaceholders", () => {
  it("replaces every known placeholder and keeps unknown ones as typed", () => {
    expect(fillPlaceholders("{Name} · {Name} · {Missing} · #{n}", { Name: "Ayşe", n: "3" })).toBe("Ayşe · Ayşe · {Missing} · #3");
  });

  it("leaves escaped braces and plain text alone", () => {
    expect(fillPlaceholders("{{Name}} and text", { Name: "Ayşe" })).toBe("{{Name}} and text");
  });
});

describe("merge store", () => {
  beforeEach(() => {
    previewFormData.mockReset();
    useMergeStore.getState().clear();
  });

  it("reads a preview of the table and shows the first row", async () => {
    previewFormData.mockResolvedValue(TABLE);

    await useMergeStore.getState().connect("C:\\data\\people.csv");

    expect(previewFormData).toHaveBeenCalledWith({ path: "C:\\data\\people.csv", sheet: undefined, limit: PREVIEW_ROWS });
    expect(previewValues(useMergeStore.getState(), "1.1.2027")).toEqual({ n: "1", date: "1.1.2027", Name: "Ayşe", Course: "Design" });
  });

  it("keeps the row inside the table when stepping past either end", async () => {
    previewFormData.mockResolvedValue(TABLE);
    await useMergeStore.getState().connect("C:\\data\\people.csv");

    useMergeStore.getState().setRow(5);
    const last = useMergeStore.getState().row;
    useMergeStore.getState().setRow(-1);

    expect(last).toBe(1);
    expect(useMergeStore.getState().row).toBe(0);
  });

  it("keeps the error and no values when the table cannot be read", async () => {
    previewFormData.mockRejectedValue({ code: "INVALID_PARAMS", message: "bad", data: { reason: "noRows" } });

    await useMergeStore.getState().connect("C:\\data\\empty.csv");

    expect(useMergeStore.getState().error?.code).toBe("INVALID_PARAMS");
    expect(useMergeStore.getState().table).toBeNull();
    expect(previewValues(useMergeStore.getState(), "")).toBeNull();
  });

  it("ignores an older answer that arrives after a newer table was chosen", async () => {
    let finishOld: (value: typeof TABLE) => void = () => undefined;
    previewFormData.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve))).mockResolvedValueOnce({ ...TABLE, columns: ["Id"] });

    const old = useMergeStore.getState().connect("C:\\old.csv");
    await useMergeStore.getState().connect("C:\\new.csv");
    finishOld(TABLE);
    await old;

    expect(useMergeStore.getState().dataPath).toBe("C:\\new.csv");
    expect(useMergeStore.getState().table?.columns).toEqual(["Id"]);
  });
});

describe("insertPlaceholder", () => {
  beforeEach(() => {
    textEditorBridge.current = null;
  });

  it("appends the column to the selected text with a space", () => {
    const text = createText(10, 10, 200, 30, "Dear");
    openWith(text);
    useStudioStore.getState().select([text.id]);

    insertPlaceholder("Name");

    expect((elements()[0] as StudioTextElement).runs.map((run) => run.text).join("")).toBe("Dear {Name}");
  });

  it("appends to a selected QR value and types into the open text editor", () => {
    const qr = createQr("https://x.test/", 0, 0, 50);
    openWith(qr);
    useStudioStore.getState().select([qr.id]);
    insertPlaceholder("Id");
    const insert = vi.fn();
    textEditorBridge.current = { applyStyle: vi.fn(), applyParagraphs: vi.fn(), update: vi.fn(), summary: () => null, selectedParagraphs: () => [], selectedText: () => "", commit: vi.fn(), insert };
    useStudioStore.getState().setEditing(qr.id);

    insertPlaceholder("n");

    expect(elements()[0]).toMatchObject({ value: "https://x.test/{Id}" });
    expect(insert).toHaveBeenCalledWith("{n}");
  });

  it("adds new selected text when nothing editable is selected", () => {
    openWith();

    insertPlaceholder("date");

    const [added] = elements() as StudioTextElement[];
    expect(added.runs[0].text).toBe("{date}");
    expect(useStudioStore.getState().selection).toEqual([added.id]);
  });
});
