import { describe, expect, it } from "vitest";
import { describeError } from "./errorMessage";

const catalog: Record<string, string> = {
  "errors.INVALID_PARAMS": "Invalid parameter.",
  "errors.reasons.noCandidates": "No underlines, boxes or check squares were found.",
  "errors.reasons.cropEmpty": "Nothing is left of page {{page}}.",
};

const t = (key: string, options?: Record<string, unknown>) => {
  const template = catalog[key];
  if (template === undefined) return String(options?.defaultValue ?? key);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
};

describe("describeError", () => {
  it("prefers the reason-specific message when the sidecar sends one", () => {
    const message = describeError(t, { code: "INVALID_PARAMS", message: "no field candidates found", data: { reason: "noCandidates" } });
    expect(message).toBe(catalog["errors.reasons.noCandidates"]);
  });

  it("fills the reason message with the details the sidecar sends", () => {
    const message = describeError(t, { code: "INVALID_PARAMS", message: "crop leaves page 3 empty", data: { reason: "cropEmpty", page: 3 } });
    expect(message).toBe("Nothing is left of page 3.");
  });

  it("falls back to the code message, then to the raw message", () => {
    expect(describeError(t, { code: "INVALID_PARAMS", message: "raw", data: { reason: "somethingUnknown" } })).toBe("Invalid parameter.");
    expect(describeError(t, { code: "INTERNAL", message: "raw" })).toBe("raw");
  });
});
