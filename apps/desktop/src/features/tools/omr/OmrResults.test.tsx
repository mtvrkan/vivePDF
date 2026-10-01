import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { OmrMark, OmrScan } from "@/types";
import { axeViolations } from "@/test/axe";
import { gradeAll, parseKeyText, reviewItems } from "./omrModel";
import { OmrReview, OmrTable } from "./OmrResults";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

function mark(state: OmrMark["state"], chosen: number[] = []): OmrMark {
  return { state, chosen, fills: [] };
}

const scan: OmrScan = {
  source: "C:/scans/class.pdf",
  page: 3,
  layout: "VPOMR1;q=3;o=4",
  questions: 3,
  options: 4,
  idDigits: 4,
  booklets: 2,
  letterCase: "upper",
  studentId: "20?6",
  idMarks: [],
  booklet: mark("single", [1]),
  marks: [mark("single", [0]), mark("unclear", [1, 2]), mark("blank")],
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  pixelScale: 1,
};

describe("OmrReview", () => {
  it("lists what needs a decision and passes the teacher's choice on", async () => {
    const onOverride = vi.fn();
    const { container } = render(<OmrReview items={reviewItems([scan], {})} scans={[scan]} onOverride={onOverride} />);

    const choices = screen.getByRole("group", { name: "Answer for question 2 on Sheet 1 (class.pdf · 3)" });
    fireEvent.click(within(choices).getByRole("button", { name: "C" }));
    fireEvent.click(within(choices).getByRole("button", { name: "Blank" }));

    expect(onOverride).toHaveBeenNthCalledWith(1, 0, { answers: { 1: [2] } });
    expect(onOverride).toHaveBeenNthCalledWith(2, 0, { answers: { 1: [] } });
    expect(screen.getByText("Question 2: unclear mark (B, C)")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("commits a corrected student number only when it changed", () => {
    const onOverride = vi.fn();
    render(<OmrReview items={reviewItems([scan], {})} scans={[scan]} onOverride={onOverride} />);
    const input = screen.getByRole("textbox", { name: "Student number for Sheet 1 (class.pdf · 3)" });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "2026" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(onOverride).toHaveBeenCalledWith(0, { studentId: "2026" });
  });

  it("draws nothing when every mark is settled", () => {
    const { container } = render(<OmrReview items={[]} scans={[scan]} onOverride={() => undefined} />);

    expect(container.childElementCount).toBe(0);
  });
});

describe("OmrTable", () => {
  it("shows one scored row per sheet with the booklet letter", async () => {
    const key = [parseKeyText("ABC", 4).cells, parseKeyText("ACD", 4).cells];
    const graded = gradeAll([scan], key, 0, { 0: { studentId: "2026", answers: { 1: [2] } } });

    const { container } = render(<OmrTable graded={graded} />);

    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual(["2026", "class.pdf · 3", "B", "2", "0", "1", "2", "66.67"]);
    expect(screen.getByRole("table", { name: "Scores of the read sheets" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
