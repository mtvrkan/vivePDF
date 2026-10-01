import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@wdio/globals";
import { answerDialogs, bootApp, clickButton, clickDropArea, copyFixture, fill, fixtures, openTool, outputPath, probe, runPrimary, t, waitForDialogsAnswered, waitForFile, waitForOutputs, workDir } from "../support/app.ts";

const READ_WORKBOOK = `
import json, sys
from openpyxl import load_workbook
book = load_workbook(sys.argv[1], read_only=True)
print(json.dumps({name: [list(row) for row in book[name].iter_rows(values_only=True)] for name in book.sheetnames}))
`;

function workbook(path: string): Record<string, unknown[][]> {
  return JSON.parse(execFileSync(process.env.VIVEPDF_E2E_PYTHON as string, ["-c", READ_WORKBOOK, path], { encoding: "utf8" })) as Record<string, unknown[][]>;
}

describe("optical answer sheets", () => {
  before(bootApp);

  it("prints the requested copies of a titled answer sheet", async () => {
    await openTool("tools.omr.sheet.title");
    await fill(t("tools.omr.sheet.questions"), "10");
    await fill(t("tools.omr.sheet.copies"), "2");
    await fill(t("tools.omr.sheet.titleLabel"), "Physics quiz");
    answerDialogs(join(workDir(), "answer-sheets.pdf"));
    await clickButton(t("tools.browse"));
    await waitForDialogsAnswered();
    const expected = await outputPath();
    expect(expected).toBe(join(workDir(), "answer-sheets.pdf"));
    await runPrimary(t("tools.omr.sheet.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(result.pages?.[1].text).toContain("Physics quiz");
    expect(result.pages?.[1].text).toContain(t("tools.omr.sheet.studentIdLabel"));
  });

  it("grades a photographed sheet, settles a faint mark and saves the results", async () => {
    const scan = copyFixture(fixtures().answers, "answer-sheet.png");
    await openTool("tools.omr.grade.title");
    answerDialogs([scan]);
    await clickDropArea(t("tools.omr.grade.dropTitle"));
    await waitForDialogsAnswered();
    await runPrimary(t("tools.omr.grade.run"));
    await $(`//table//td[normalize-space(.)="2026"]`).waitForDisplayed({ timeout: 120000 });

    const bookletB = $(`//*[@role="radio"][normalize-space(.)="${t("tools.omr.key.bookletTab", { letter: "B" })}"]`);
    await bookletB.waitForClickable();
    await bookletB.click();
    await fill(t("tools.omr.key.text"), "ABCDABCDAB");

    const sheetName = t("tools.omr.results.sheetName", { number: 1, source: "answer-sheet.png" });
    const choices = $(`//*[@role="group"][@aria-label="${t("tools.omr.review.pick", { name: sheetName, number: 10 })}"]`);
    await choices.waitForDisplayed();
    await choices.$(`.//button[normalize-space(.)="B"]`).click();
    await choices.waitForDisplayed({ reverse: true });

    const row = await $$(`//table//tr[td[normalize-space(.)="2026"]]/td`).map((cell) => cell.getText());
    expect(row).toEqual(["2026", "answer-sheet.png", "B", "9", "1", "0", "9", "90"]);

    const results = join(workDir(), "omr-results.xlsx");
    answerDialogs(results);
    await clickButton(t("tools.omr.export.results"));
    await waitForFile(results);
    const book = workbook(results);
    expect(Object.keys(book)).toEqual([t("tools.omr.results.studentsSheet"), t("tools.omr.results.questionsSheet")]);
    expect(book[t("tools.omr.results.studentsSheet")][1]).toEqual(["2026", "answer-sheet.png", "B", 9, 1, 0, 9, 90, "A", "B", "BC", "D", "A", "B", "C", "D", "A", "B"]);
    expect(book[t("tools.omr.results.questionsSheet")]).toHaveLength(11);

    const marked = join(workDir(), "omr-marked.pdf");
    answerDialogs(marked);
    await clickButton(t("tools.omr.export.review"));
    await waitForFile(marked);
    const review = probe(marked);
    expect(review.pageCount).toBe(1);
    expect(review.pages?.[0].text).toContain(t("tools.omr.export.reviewHeader", { student: "2026", correct: 9, wrong: 1, blank: 0, net: 9 }));
  });
});
