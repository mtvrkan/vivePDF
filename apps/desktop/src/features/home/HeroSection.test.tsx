import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { HeroSection } from "./HeroSection";

vi.mock("@/features/viewer/useOpenPdf", () => ({ useOpenPdf: () => ({ pickAndOpen: vi.fn(), openClipboard: vi.fn() }) }));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  useDropTargetStore.setState({ dragging: false });
});

describe("HeroSection", () => {
  it("highlights the drop zone while a native file drag is in progress", () => {
    const { container } = render(<HeroSection />, { wrapper: MemoryRouter });
    const zone = () => container.querySelector("button.border-dashed") as HTMLElement;
    expect(zone().dataset.active).toBeUndefined();

    act(() => useDropTargetStore.getState().setDragging(true));

    expect(zone().dataset.active).toBe("true");
  });
});
