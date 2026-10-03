import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import type { FontChoice } from "@/types";

const fontCatalogue = vi.fn();
const downloadLibraryFont = vi.fn();
const removeLibraryFont = vi.fn();
vi.mock("@/shared/rpc/operations", () => ({
  fontCatalogue: (...args: unknown[]) => fontCatalogue(...args),
  downloadLibraryFont: (...args: unknown[]) => downloadLibraryFont(...args),
  removeLibraryFont: (...args: unknown[]) => removeLibraryFont(...args),
  addFont: vi.fn(),
  removeFont: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { FontPicker } from "./FontPicker";

const BUNDLED: FontChoice = { id: "bundled:dejavu-sans", name: "DejaVu Sans", source: "bundled", styles: ["Bold", "Regular"] };
const INTER: FontChoice = { id: "library:inter", name: "Inter", source: "library", styles: ["Regular"], installed: false, bytes: 2 * 1024 * 1024, category: "sans" };

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

describe("FontPicker library fonts", () => {
  beforeEach(() => {
    fontCatalogue.mockReset();
    downloadLibraryFont.mockReset();
    removeLibraryFont.mockReset();
    useFontLibraryStore.setState({ revision: 0 });
  });

  it("downloads a library font when it is chosen and then selects it", async () => {
    fontCatalogue.mockResolvedValueOnce({ fonts: [BUNDLED, INTER] }).mockResolvedValue({ fonts: [BUNDLED, { ...INTER, installed: true }] });
    downloadLibraryFont.mockResolvedValue({ ...INTER, installed: true });
    const onChange = vi.fn();
    render(<FontPicker value={BUNDLED.id} onChange={onChange} />);
    await waitFor(() => expect(fontCatalogue).toHaveBeenCalled());

    act(() => {
      fireEvent.click(screen.getByRole("combobox"));
    });
    act(() => {
      fireEvent.click(screen.getByRole("option", { name: /^Inter — download 2/ }));
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("library:inter"));
    expect(downloadLibraryFont).toHaveBeenCalledWith({ id: "library:inter" });
    expect(useFontLibraryStore.getState().revision).toBe(1);
  });

  it("keeps the current font when the download fails", async () => {
    fontCatalogue.mockResolvedValue({ fonts: [BUNDLED, INTER] });
    downloadLibraryFont.mockRejectedValue({ code: "NETWORK", message: "offline" });
    const onChange = vi.fn();
    render(<FontPicker value={BUNDLED.id} onChange={onChange} />);
    await waitFor(() => expect(fontCatalogue).toHaveBeenCalled());

    act(() => {
      fireEvent.click(screen.getByRole("combobox"));
    });
    act(() => {
      fireEvent.click(screen.getByRole("option", { name: /Inter/ }));
    });

    await waitFor(() => expect(downloadLibraryFont).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers to remove a downloaded library font and falls back to the bundled one", async () => {
    fontCatalogue.mockResolvedValue({ fonts: [BUNDLED, { ...INTER, installed: true }] });
    removeLibraryFont.mockResolvedValue({ ...INTER, installed: false });
    const onChange = vi.fn();
    render(<FontPicker value="library:inter" onChange={onChange} />);

    const remove = await screen.findByRole("button", { name: "Remove the downloaded font" });
    act(() => {
      fireEvent.click(remove);
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("bundled:dejavu-sans"));
    expect(removeLibraryFont).toHaveBeenCalledWith({ id: "library:inter" });
  });
});
