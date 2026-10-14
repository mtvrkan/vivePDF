import { describe, expect, it, vi } from "vitest";
import { applyCommand, commandForKey, type CommandTarget } from "./presenterCommands";

function target(currentPage: number, totalPages = 5): CommandTarget {
  return { currentPage, totalPages, goToPage: vi.fn(), toggleBlackout: vi.fn(), clearBlackout: vi.fn(), end: vi.fn() };
}

const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe("presenterCommands", () => {
  it("moves between pages and jumps to either end", () => {
    const middle = target(3);
    applyCommand("next", middle);
    applyCommand("previous", middle);
    applyCommand("first", middle);
    applyCommand("last", middle);

    expect(vi.mocked(middle.goToPage).mock.calls).toEqual([[4], [2], [1], [5]]);
  });

  it("stays put at the first and last page", () => {
    const first = target(1);
    const last = target(5);

    applyCommand("previous", first);
    applyCommand("first", first);
    applyCommand("next", last);
    applyCommand("last", last);

    expect(first.goToPage).not.toHaveBeenCalled();
    expect(last.goToPage).not.toHaveBeenCalled();
  });

  it("turns screen keys into commands and ignores shortcuts with modifiers", () => {
    expect(commandForKey(key("ArrowRight"))).toBe("next");
    expect(commandForKey(key(" ", { shiftKey: true }))).toBe("previous");
    expect(commandForKey(key("B"))).toBe("blackoutBlack");
    expect(commandForKey(key("Escape"))).toBe("end");
    expect(commandForKey(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(commandForKey(key("q"))).toBeNull();
  });

  it("toggles the boards and ends the show", () => {
    const view = target(2);

    applyCommand("blackoutWhite", view);
    applyCommand("clearBlackout", view);
    applyCommand("end", view);

    expect(view.toggleBlackout).toHaveBeenCalledWith("white");
    expect(view.clearBlackout).toHaveBeenCalledTimes(1);
    expect(view.end).toHaveBeenCalledTimes(1);
  });
});
