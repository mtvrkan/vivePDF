import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS, parseNotes, serializeNotes } from "./presenterNotes";

describe("presenterNotes", () => {
  it("round-trips notes keyed by page index", () => {
    const text = serializeNotes({ 0: "Opening", 6: "Pause for questions" }, 24, new Date("2026-10-14T10:00:00Z"));

    expect(JSON.parse(text!)).toEqual({ version: 1, pageCount: 24, updatedAt: "2026-10-14T10:00:00.000Z", notes: { 0: "Opening", 6: "Pause for questions" } });
    expect(parseNotes(text)).toEqual({ 0: "Opening", 6: "Pause for questions" });
  });

  it("drops blank notes, deletes the file when none are left and trims long notes", () => {
    expect(serializeNotes({ 1: "   ", 2: "" }, 3)).toBeNull();
    const long = serializeNotes({ 0: "x".repeat(MAX_NOTE_CHARS + 5) }, 1);
    expect(parseNotes(long)[0]).toHaveLength(MAX_NOTE_CHARS);
  });

  it("treats a missing, broken or foreign file as having no notes", () => {
    expect(parseNotes(null)).toEqual({});
    expect(parseNotes("{not json")).toEqual({});
    expect(parseNotes(JSON.stringify({ version: 2, notes: { 0: "a" } }))).toEqual({});
    expect(parseNotes(JSON.stringify({ version: 1, notes: { "-1": "a", x: "b", 3: 4, 5: "kept" } }))).toEqual({ 5: "kept" });
  });
});
