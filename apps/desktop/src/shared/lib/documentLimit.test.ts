import { describe, expect, it } from "vitest";
import { MAX_OPEN_DOCUMENTS, documentRoomError } from "./documentLimit";

describe("documentRoomError", () => {
  it("lets a document open while there is room", () => {
    expect(documentRoomError(0)).toBeNull();
  });

  it("allows the last free slot and refuses the one after it", () => {
    expect(documentRoomError(MAX_OPEN_DOCUMENTS - 1)).toBeNull();
    expect(documentRoomError(MAX_OPEN_DOCUMENTS)).toEqual({ code: "UNSUPPORTED", message: "too many documents are open", data: { reason: "tooManyDocuments", max: MAX_OPEN_DOCUMENTS } });
  });

  it("refuses a pair when only one slot is free", () => {
    expect(documentRoomError(MAX_OPEN_DOCUMENTS - 1, 2)?.data?.reason).toBe("tooManyDocuments");
    expect(documentRoomError(MAX_OPEN_DOCUMENTS - 2, 2)).toBeNull();
  });
});
