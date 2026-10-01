import { describe, expect, it } from "vitest";
import { summarizeFormsResult } from "./formsResult";

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

describe("summarizeFormsResult", () => {
  it("counts exported form data by its field count", () => {
    expect(summarizeFormsResult({ output: "a.xfdf", fields: 7 }, t)).toEqual({ count: 7, caption: "tools.forms.data.exportedCaption", outputs: ["a.xfdf"] });
  });

  it("reports imported values together with the fields the form lacked", () => {
    const summary = summarizeFormsResult({ output: "o.pdf", pageCount: 1, bytes: 10, filled: 3, unmatched: ["x", "y"] }, t);
    expect(summary.count).toBe(3);
    expect(summary.caption).toBe('tools.forms.data.importedCaption:{"unmatched":2}');
  });

  it("still counts detected fields and merge outputs", () => {
    expect(summarizeFormsResult({ output: "d.pdf", pageCount: 1, bytes: 1, fields: [{ name: "a", kind: "text", page: 1, rect: [0, 0, 1, 1], label: "" }] }, t).count).toBe(1);
    expect(summarizeFormsResult({ outputs: [{ output: "1.pdf", row: 1 }, { output: "2.pdf", row: 2 }], rows: 2, skipped: 0, unmatchedFields: [] }, t).outputs).toEqual(["1.pdf", "2.pdf"]);
  });

  it("adds the recalculated fields to the caption when any were touched", () => {
    const summary = summarizeFormsResult({ output: "o.pdf", pageCount: 1, bytes: 10, filled: 2, recalculated: 3, calcSkipped: 1 }, t);
    expect(summary.caption).toBe('tools.forms.filledCaption · tools.forms.recalculated:{"count":3,"skipped":1}');
    expect(summarizeFormsResult({ output: "o.pdf", pageCount: 1, bytes: 10, filled: 2, recalculated: 0, calcSkipped: 0 }, t).caption).toBe("tools.forms.filledCaption");
  });

  it("tells what filling had to change or keep", () => {
    const summary = summarizeFormsResult({ output: "o.pdf", pageCount: 1, bytes: 10, filled: 2, truncated: ["code"], missingGlyphs: ["漢"], xfaRemoved: true, signaturesKept: true }, t);
    expect(summary.caption).toBe('tools.forms.filledCaption · tools.forms.truncated:{"count":1,"names":"code"} · tools.forms.missingGlyphs:{"characters":"漢"} · tools.forms.xfaRemoved · tools.forms.signaturesKept');
  });
});
