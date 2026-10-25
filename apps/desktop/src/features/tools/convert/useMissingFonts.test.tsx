import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMissingFonts } from "./useMissingFonts";

const officeFonts = vi.fn();

vi.mock("@/shared/rpc/operations", () => ({
  officeFonts: (...args: unknown[]) => officeFonts(...args),
}));

beforeEach(() => {
  officeFonts.mockReset();
});

describe("useMissingFonts", () => {
  it("asks once per Office file and keeps the fonts it lacks", async () => {
    officeFonts.mockResolvedValue({ missing: ["Aptos", "Geist"] });

    const { result, rerender } = renderHook(({ files }) => useMissingFonts(files, true), {
      initialProps: { files: ["/belgeler/rapor.docx", "/belgeler/not.txt"] },
    });
    await waitFor(() => expect(result.current["/belgeler/rapor.docx"]).toEqual(["Aptos", "Geist"]));
    rerender({ files: ["/belgeler/rapor.docx", "/belgeler/not.txt"] });

    expect(officeFonts).toHaveBeenCalledOnce();
    expect(officeFonts).toHaveBeenCalledWith({ path: "/belgeler/rapor.docx" });
    expect(result.current["/belgeler/not.txt"]).toBeUndefined();
  });

  it("asks nothing while LibreOffice is missing", () => {
    const { result } = renderHook(() => useMissingFonts(["/belgeler/rapor.docx"], false));

    expect(officeFonts).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("shows no warning and asks again later when the check fails", async () => {
    officeFonts.mockRejectedValueOnce(new Error("engine busy")).mockResolvedValue({ missing: ["Aptos"] });

    const { result, rerender } = renderHook(({ files }) => useMissingFonts(files, true), {
      initialProps: { files: ["/belgeler/rapor.docx"] },
    });
    await waitFor(() => expect(officeFonts).toHaveBeenCalledOnce());
    expect(result.current).toEqual({});
    rerender({ files: ["/belgeler/rapor.docx", "/belgeler/ek.pptx"] });

    await waitFor(() => expect(result.current["/belgeler/rapor.docx"]).toEqual(["Aptos"]));
    expect(officeFonts).toHaveBeenCalledTimes(3);
  });
});
