import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseOption, clickDropArea, copyFixture, fixtures, openTool, probe, runPrimary, t, typeInto, waitForDialogsAnswered, waitForOutputs, workDir } from "../support/app.ts";

const PASSWORD = "Toplu-İşlem-7";

describe("batch", () => {
  before(bootApp);

  it("runs a compress then password chain on two files", async () => {
    const first = copyFixture(fixtures().sample, "batch-one.pdf");
    const second = copyFixture(fixtures().second, "batch-two.pdf");
    await openTool("nav.batch");
    answerDialogs([first, second]);
    await clickDropArea(t("tools.batch.dropTitle"));
    await waitForDialogsAnswered();

    await chooseOption(t("tools.batch.addStep"), t("tools.batch.operations.encrypt.title"));
    const addStep = $(`//button[not(@role)][normalize-space(.)="${t("tools.batch.addStep")}"]`);
    await addStep.waitForClickable();
    await addStep.click();
    const steps = $$(`//li[.//button[@aria-label="${t("tools.batch.removeStep")}"]]`);
    await expect(steps).toBeElementsArrayOfSize(2);
    await expect(steps[0]).toHaveText(expect.stringContaining(t("tools.batch.operations.compress.title")));
    await typeInto(steps[1].$(`.//label[span[normalize-space(.)="${t("tools.security.encrypt.userPassword")}"]]//input`), PASSWORD);

    await runPrimary(t("tools.batch.run", { count: 2 }));
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(2);
    const expectedPages: Record<string, number> = { "batch-one": 3, "batch-two": 2 };
    for (const output of outputs) {
      const locked = probe(output);
      expect(locked.encrypted).toBe(true);
      expect(locked.unlocked).toBe(false);
      const stem = Object.keys(expectedPages).find((name) => output.includes(name));
      expect(stem).toBeDefined();
      expect(probe(output, PASSWORD).pageCount).toBe(expectedPages[stem as string]);
    }
  });

  it("retries only the files that failed and merges every finished file", async () => {
    const good = copyFixture(fixtures().sample, "retry-good.pdf");
    const broken = join(workDir(), "retry-broken.pdf");
    writeFileSync(broken, "not a pdf");
    await openTool("nav.batch");
    const clear = $(`//button[normalize-space(.)="${t("tools.batch.clear")}"]`);
    if (await clear.isExisting()) await clear.click();
    const removers = `//button[@aria-label="${t("tools.batch.removeStep")}"]`;
    while ((await $$(removers).length) > 1) await $$(removers)[1].click();

    const merge = $(`//label[.//*[normalize-space(text())="${t("tools.batch.mergeAtEnd")}"]]`);
    await merge.waitForClickable();
    if (!(await merge.$(".//input").isSelected())) await merge.click();
    answerDialogs([good, broken]);
    await clickDropArea(t("tools.batch.dropTitle"));
    await waitForDialogsAnswered();

    await runPrimary(t("tools.batch.run", { count: 2 }));
    await $(`//*[normalize-space(text())="${t("tools.batch.summaryWithErrors", { done: 1, failed: 1 })}"]`).waitForExist({ timeout: 120000 });
    const first = await waitForOutputs();
    expect(first).toHaveLength(1);

    copyFileSync(fixtures().second, broken);
    const retry = $(`//button[normalize-space(.)="${t("tools.batch.retryFailed", { count: 1 })}"]`);
    await retry.waitForClickable();
    await retry.click();
    await $(`//*[normalize-space(text())="${t("tools.batch.summaryMerged", { count: 2 })}"]`).waitForExist({ timeout: 120000 });
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(3);
    expect(outputs.filter((output) => output.includes("retry-good"))).toEqual(first);
    const merged = outputs.find((output) => !output.includes("retry-"));
    expect(merged).toBeDefined();
    expect(probe(merged as string).pageCount).toBe(5);
  });
});
