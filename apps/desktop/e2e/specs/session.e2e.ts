import { existsSync } from "node:fs";
import { basename } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { bootApp, clickButton, copyFixture, fill, fixtures, outputPath, probe, runPrimary, t, waitForOutputs } from "../support/app.ts";

describe("session", () => {
  before(bootApp);

  it("asks again for the password of an inserted file after a session is restored", async () => {
    const main = copyFixture(fixtures().sample, "session-main.pdf");
    const locked = copyFixture(fixtures().locked, "session-locked.pdf");
    const snapshot = {
      savedAt: Date.now(),
      route: "/pages",
      documents: [main],
      activePath: main,
      organizer: {
        mainPath: main,
        tiles: [
          { key: "p1", kind: "page", sourceId: "main", index: 1, rotate: 0 },
          { key: "x1", kind: "page", sourceId: "s-lock", index: 1, rotate: 0 },
        ],
        sources: [
          { id: "main", path: main, fileName: basename(main), pageCount: 3 },
          { id: "s-lock", path: locked, fileName: basename(locked), pageCount: 1 },
        ],
        selected: [],
      },
    };
    await browser.execute((raw) => localStorage.setItem("vivepdf.session", raw), JSON.stringify(snapshot));
    await browser.refresh();

    const prompt = $(`//p[normalize-space(.)="${t("tools.pages.restoredPassword", { name: basename(locked) })}"]`);
    await expect(prompt).toBeDisplayed({ wait: 60000 });
    await fill(t("password.label"), "wrong");
    await clickButton(t("password.open"));
    await expect($(`//*[@role="alert"][normalize-space(.)="${t("password.wrong")}"]`)).toBeDisplayed({ wait: 30000 });
    await fill(t("password.label"), "secret");
    await clickButton(t("password.open"));
    await expect(prompt).not.toBeDisplayed({ wait: 30000 });
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(2);
    await expect($(`li[data-tile-index="1"] img`)).toBeDisplayed({ wait: 30000 });

    const expected = await outputPath();
    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(result.pages?.[0].text).toContain("Sample page 1");
    expect(result.pages?.[1].text).toContain("Locked page 1");
  });
});
