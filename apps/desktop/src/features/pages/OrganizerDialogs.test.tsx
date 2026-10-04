import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { OrganizerTile } from "@/types";

vi.mock("./PageThumbnail", () => ({ PageThumbnail: () => <div data-testid="thumbnail" /> }));

const { PagePreviewDialog } = await import("./OrganizerDialogs");

const tile: OrganizerTile = { key: "p2", kind: "page", sourceId: "main", index: 2, rotate: 0 };

function renderPreview(overrides: Partial<Parameters<typeof PagePreviewDialog>[0]> = {}) {
  const props = {
    tile,
    position: 1,
    total: 4,
    label: null,
    sources: {},
    selected: false,
    selectedCount: 1,
    onClose: vi.fn(),
    onStep: vi.fn(),
    onRotate: vi.fn(),
    onToggleSelect: vi.fn(),
    onOpenInViewer: null,
    ...overrides,
  };
  render(<PagePreviewDialog {...props} />);
  return props;
}

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("PagePreviewDialog selection", () => {
  it("shows whether the previewed page is selected and toggles it on click", () => {
    const props = renderPreview({ selected: true, selectedCount: 3 });
    const toggle = screen.getByRole("checkbox", { name: "Select this page" });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("3 pages selected");

    fireEvent.click(toggle);
    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it("toggles the selection with Enter and extends it with Shift and the arrows", () => {
    const onStep = vi.fn();
    const props = renderPreview({ onStep });

    press("Enter");
    press("ArrowRight", { shiftKey: true });
    press("ArrowLeft");

    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onStep.mock.calls).toEqual([
      [1, true],
      [-1, false],
    ]);
  });

  it("toggles once when Enter is pressed on the focused toggle itself", () => {
    const props = renderPreview();
    const toggle = screen.getByRole("checkbox", { name: "Select this page" });

    press("Enter", {}, toggle);

    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter to another focused button instead of toggling the selection", () => {
    const props = renderPreview();

    press("Enter", {}, screen.getByRole("button", { name: "Next page" }));

    expect(props.onToggleSelect).not.toHaveBeenCalled();
  });

  it("explains the selection keys in the hint and offers the viewer for original pages", () => {
    const onOpenInViewer = vi.fn();
    renderPreview({ onOpenInViewer });

    expect(screen.getByText(/Enter selects or deselects the page/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in viewer" }));
    expect(onOpenInViewer).toHaveBeenCalledTimes(1);
  });
});
