import { afterEach, describe, expect, it, vi } from "vitest";
import { useLaunchStore } from "@/shared/store/launchStore";
import { canOfferRepair, openInRepair, REPAIR_PATHNAME, REPAIR_ROUTE } from "./repairRoute";

const damaged = { code: "INVALID_PDF" as const, message: "damaged" };

describe("repair route", () => {
  afterEach(() => useLaunchStore.getState().setPending(null));

  it("offers Repair for a damaged file with a known path", () => {
    expect(canOfferRepair(damaged, "C:/a.pdf", false)).toBe(true);
    expect(canOfferRepair({ code: "INTERNAL", message: "engine" }, "C:/a.pdf", false)).toBe(true);
  });

  it("stays quiet without a path, on the Repair tab or for other errors", () => {
    expect(canOfferRepair(damaged, undefined, false)).toBe(false);
    expect(canOfferRepair(damaged, "C:/a.pdf", true)).toBe(false);
    expect(canOfferRepair({ code: "NEEDS_PASSWORD", message: "locked" }, "C:/a.pdf", false)).toBe(false);
    expect(canOfferRepair(null, "C:/a.pdf", false)).toBe(false);
  });

  it("hands the file to the Repair tab and navigates there", () => {
    const navigate = vi.fn();
    openInRepair("C:/a.pdf", navigate);
    expect(navigate).toHaveBeenCalledWith(REPAIR_ROUTE);
    expect(useLaunchStore.getState().pendingPath).toBe("C:/a.pdf");
    expect(useLaunchStore.getState().pendingRoute).toBe(REPAIR_PATHNAME);
  });
});
