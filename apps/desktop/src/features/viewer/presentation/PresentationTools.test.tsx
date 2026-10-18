import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { DEFAULT_BOARD_PENS, usePresentationStore, type BlackoutMode, type PresentationTool } from "@/shared/store/presentationStore";
import { PresentationStyleControls } from "./PresentationTools";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  usePresentationStore.getState().resetSession();
  usePresentationStore.getState().resetPrefs();
});

afterEach(cleanup);

function open(blackout: BlackoutMode, tool: PresentationTool) {
  act(() => {
    usePresentationStore.getState().setBlackout(blackout);
    usePresentationStore.getState().setTool(tool);
  });
  render(<PresentationStyleControls />);
}

describe("presentation style controls", () => {
  it("changes the board pen, not the slide pen, while a board is shown", () => {
    open("black", "pen");

    fireEvent.click(screen.getByRole("button", { name: "#3E63DD" }));
    fireEvent.change(screen.getByRole("slider", { name: /Thickness/ }), { target: { value: "9" } });

    const state = usePresentationStore.getState();
    expect(state.boardPens.black).toMatchObject({ penColor: "#3E63DD", penWidth: 9 });
    expect(state.penColor).toBe("#E5484D");
    expect(state.penWidth).toBe(3);
  });

  it("keeps a separate highlighter colour on the board", () => {
    open("white", "highlighter");

    fireEvent.click(screen.getByRole("button", { name: "#30A46C" }));

    expect(usePresentationStore.getState().boardPens.white).toMatchObject({ highlighterColor: "#30A46C", penColor: DEFAULT_BOARD_PENS.white.penColor });
  });

  it("changes the slide pen on the slides and for text even on a board", () => {
    open("none", "pen");
    fireEvent.click(screen.getByRole("button", { name: "#3E63DD" }));
    cleanup();
    open("black", "text");
    fireEvent.click(screen.getByRole("button", { name: "#30A46C" }));

    const state = usePresentationStore.getState();
    expect(state.penColor).toBe("#30A46C");
    expect(state.boardPens.black.penColor).toBe(DEFAULT_BOARD_PENS.black.penColor);
  });
});
