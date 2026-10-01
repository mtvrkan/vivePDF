import { describe, expect, it } from "vitest";
import { sheetLabels } from "./sheetLabels";

describe("sheetLabels", () => {
  it("reads each sheet name from its own translation key", () => {
    expect(sheetLabels((key) => key.split(".").pop() ?? "")).toEqual({ pageLabel: "page", tableLabel: "table", textLabel: "text" });
  });
});
