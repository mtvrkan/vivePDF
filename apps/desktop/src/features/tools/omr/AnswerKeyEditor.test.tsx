import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { AnswerKeyEditor } from "./AnswerKeyEditor";
import { emptyKey, keyText, type AnswerKey } from "./omrModel";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

function Harness({ booklets = 1, onKey, onViewer = () => undefined }: { booklets?: number; onKey?: (key: AnswerKey) => void; onViewer?: (booklet: number) => void }) {
  const [key, setKey] = useState(() => emptyKey(booklets, 5));
  return (
    <AnswerKeyEditor
      value={key}
      options={4}
      viewerAnswers={3}
      onUseViewerAnswers={onViewer}
      onChange={(next) => {
        setKey(next);
        onKey?.(next);
      }}
    />
  );
}

describe("AnswerKeyEditor", () => {
  it("fills the key from typed text and shows it on the grid", async () => {
    const onKey = vi.fn();
    const { container } = render(<Harness onKey={onKey} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Key as text" }), { target: { value: "ab*(cd)" } });

    expect(keyText(onKey.mock.lastCall![0][0])).toBe("AB*(CD)-");
    expect(screen.getByText("4 of 5 questions keyed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Question 1, option A" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Question 4, option D" }).getAttribute("aria-pressed")).toBe("true");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("marks letters the sheet does not have instead of dropping them silently", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Key as text" });

    fireEvent.change(input, { target: { value: "AEQ" } });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Not an option on this sheet: E Q")).toBeTruthy();
  });

  it("toggles options and cancels questions on the chosen booklet only", () => {
    const onKey = vi.fn();
    const onViewer = vi.fn();
    render(<Harness booklets={2} onKey={onKey} onViewer={onViewer} />);

    fireEvent.click(screen.getByRole("radio", { name: "Booklet B" }));
    fireEvent.click(screen.getByRole("button", { name: "Question 2, option C" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel question 3; it counts as correct for everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Use the 3 answers from the open document" }));

    const [first, second] = onKey.mock.lastCall![0] as AnswerKey;
    expect(keyText(first)).toBe("-----");
    expect(keyText(second)).toBe("-C*--");
    expect(onViewer).toHaveBeenCalledWith(1);
  });
});
