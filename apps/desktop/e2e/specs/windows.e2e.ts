import { $, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, copyFixture, fixtures, openInViewer, openTool, pressShortcut, t, waitForDialogsAnswered } from "../support/app.ts";

async function waitForWindows(count: number) {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 60000,
    timeoutMsg: `expected ${count} windows`,
  });
  return browser.getWindowHandles();
}

const pageNumber = () => $(`input[aria-label="${t("viewer.pageNumber")}"]`);
const tab = (name: string) => $(`[role="tab"][aria-selected] span[title="${name}"]`);

describe("windows", () => {
  before(bootApp);

  it("moves a tab into its own window that shares settings and closes on its own", async () => {
    const path = copyFixture(fixtures().sample, "window-sample.pdf");
    await openInViewer(path);
    const main = await browser.getWindowHandle();

    await tab("window-sample.pdf").click({ button: "right" });
    const move = $('[role="menuitem"][data-menu-id="move-to-window"]');
    await move.waitForDisplayed();
    await move.click();

    const handles = await waitForWindows(2);
    await expect(tab("window-sample.pdf")).not.toBeExisting({ wait: 30000 });
    const second = handles.find((handle) => handle !== main) ?? "";
    await browser.switchToWindow(second);
    await pageNumber().waitForDisplayed({ timeout: 60000 });
    await expect(tab("window-sample.pdf")).toBeExisting();
    await expect(pageNumber()).toHaveValue("1");

    await browser.switchToWindow(main);
    await openTool("palette.action.themeDark");
    await browser.switchToWindow(second);
    await browser.waitUntil(async () => browser.execute(() => document.documentElement.classList.contains("dark")), {
      timeout: 15000,
      timeoutMsg: "the second window did not follow the theme",
    });

    await $(`button[aria-label="${t("window.close")}"]`).click();
    await waitForWindows(1);
    await browser.switchToWindow(main);
    await openTool("palette.action.themeLight");
    await openTool("palette.action.newWindow");
    const opened = (await waitForWindows(2)).find((handle) => handle !== main) ?? "";
    await browser.switchToWindow(opened);
    await $(`nav[aria-label="${t("nav.workspace")}"]`).waitForExist({ timeout: 60000 });
    await expect(pageNumber()).not.toBeExisting();
    await $(`button[aria-label="${t("window.close")}"]`).click();
    await waitForWindows(1);
    await browser.switchToWindow(main);
  });

  it("sends a file that is open in another window back to that window instead of opening it twice", async () => {
    const path = copyFixture(fixtures().sample, "window-once.pdf");
    await openInViewer(path);
    const main = await browser.getWindowHandle();
    await openTool("palette.action.newWindow");
    const opened = (await waitForWindows(2)).find((handle) => handle !== main) ?? "";
    await browser.switchToWindow(opened);
    await $(`nav[aria-label="${t("nav.workspace")}"]`).waitForExist({ timeout: 60000 });

    answerDialogs(path);
    await pressShortcut("o");
    await waitForDialogsAnswered();
    await browser.pause(3000);
    await expect(tab("window-once.pdf")).not.toBeExisting();
    await expect(pageNumber()).not.toBeExisting();
    expect(await browser.getWindowHandles()).toHaveLength(2);

    await browser.switchToWindow(main);
    await expect(tab("window-once.pdf")).toBeExisting();
    await browser.switchToWindow(opened);
    await $(`button[aria-label="${t("window.close")}"]`).click();
    await waitForWindows(1);
    await browser.switchToWindow(main);
  });
});
