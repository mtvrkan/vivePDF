import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { bootApp, clickButton, copyFixture, fixtures, openInViewer, probe, t, workDir } from "../support/app.ts";

const CONTROL_KEY = String.fromCharCode(0xe009);
const SHIFT_KEY = String.fromCharCode(0xe008);
const ESCAPE_KEY = String.fromCharCode(0xe00c);
const RIGHT_KEY = String.fromCharCode(0xe014);

const displayItem = (id: string) => $(`[role="menu"] [data-menu-id="${id}"]`);
const pane = () => $("section[data-split-pane]");
const paneCounter = () => pane().$("[data-split-page]");
const unsavedHint = () => pane().$(`.//*[@role="status"][normalize-space(.)="${t("viewer.split.unsaved")}"]`);

async function chooseDisplay(id: string, parent: string) {
  await clickButton(t("viewer.pageDisplay.title"));
  await $(`[role="menu"][aria-label="${t("viewer.pageDisplay.title")}"]`).waitForDisplayed();
  await displayItem(parent).waitForClickable();
  await displayItem(parent).moveTo();
  await displayItem(id).waitForClickable();
  await displayItem(id).click();
  await $(`[role="menu"][aria-label="${t("viewer.pageDisplay.title")}"]`).waitForDisplayed({ reverse: true });
}

async function primaryPoint(x: number, y: number) {
  const page = $('[data-split-layout] > div:first-child [data-page-index="0"]');
  await page.waitForDisplayed();
  await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: "page 1 never rendered" });
  const box = await browser.execute(() => {
    const rect = (document.querySelector('[data-split-layout] > div:first-child [data-page-index="0"]') as HTMLElement).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  });
  const scale = box.width / 595;
  return { origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + y * scale) };
}

async function waitForPanePage(page: string, timeoutMsg: string) {
  await browser.waitUntil(async () => (await paneCounter().isExisting()) && (await paneCounter().getAttribute("data-split-page")) === page, { timeout: 30000, timeoutMsg });
}

describe("split window", () => {
  before(bootApp);

  it("reads another page in a read-only pane that follows saves", async () => {
    const path = copyFixture(fixtures().sample, "split.pdf");
    await openInViewer(path);
    await chooseDisplay("split-columns", "split-view");

    await pane().waitForDisplayed({ timeout: 30000 });
    await expect($('[data-split-layout="columns"]')).toBeExisting();
    await paneCounter().waitForDisplayed({ timeout: 60000, timeoutMsg: "the read-only pane never loaded the file" });
    await expect(paneCounter()).toHaveText("1 / 3");
    await expect(pane().$('[data-read-only] [data-page-index="0"]')).toBeExisting();

    await browser.execute(() => {
      const scroller = document.querySelector("section[data-split-pane] [data-pan-scroller]") as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await waitForPanePage("3", "the pane did not scroll to page 3");
    await expect($(`input[aria-label="${t("viewer.pageNumber")}"]`)).toHaveValue("1");

    await clickButton(t("viewer.annotate"));
    await clickButton(t("annotate.highlight"));
    const start = await primaryPoint(66, 84);
    const end = await primaryPoint(200, 84);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(start)
      .down()
      .move({ ...end, duration: 300 })
      .up()
      .perform();
    await unsavedHint().waitForDisplayed({ timeoutMsg: "the pane did not say that unsaved changes are missing" });

    const before = await pane().getAttribute("data-split-document");
    await clickButton(t("annotate.save"));
    const overwrite = $(`//button[normalize-space(.)="${t("tools.overwrite")}"]`);
    if (await overwrite.waitForClickable({ timeout: 3000 }).catch(() => false)) await overwrite.click();
    await browser.waitUntil(() => (probe(path).pages?.[0].annotations ?? []).includes("Highlight"), { timeout: 30000, timeoutMsg: "the highlight was not saved" });
    await unsavedHint().waitForDisplayed({ reverse: true, timeout: 30000 });
    await browser.waitUntil(async () => {
      const current = await pane().getAttribute("data-split-document");
      return Boolean(current) && current !== before;
    }, { timeout: 30000, timeoutMsg: "the pane did not reopen the saved file" });
    await waitForPanePage("3", "the reopened pane did not return to page 3");
    await browser.saveScreenshot(join(workDir(), "split-columns.png"));
  });

  it("offers the reading part of the right-click menu in the pane", async () => {
    const menu = $(`[role="menu"][aria-label="${t("viewer.context.title")}"]`);
    const point = await browser.execute(() => {
      const rect = (document.querySelector('section[data-split-pane] [data-page-index="2"]') as HTMLElement).getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 12) };
    });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move({ origin: "viewport", ...point }).down({ button: 2 }).up({ button: 2 }).perform();
    await menu.waitForDisplayed({ timeoutMsg: "no context menu opened in the read-only pane" });
    await expect(menu.$('[data-menu-id="go-to-page"]')).toBeExisting();
    await expect(menu.$('[data-menu-id="copy-page-link"]')).toBeExisting();
    await expect(menu.$('[data-menu-id="add-bookmark"]')).not.toBeExisting();
    await expect(menu.$('[data-menu-id="page-selectable"]')).not.toBeExisting();
    await browser.keys(ESCAPE_KEY);
    await menu.waitForDisplayed({ reverse: true, timeoutMsg: "the pane menu stayed open after Escape" });
  });

  it("resizes from the keyboard, stacks the panes and closes with the shortcut", async () => {
    await browser.keys(ESCAPE_KEY);
    const divider = $('[role="separator"][data-split-divider]');
    await divider.click();
    await browser.keys(RIGHT_KEY);
    await expect(divider).toHaveAttribute("aria-valuenow", "55");

    await chooseDisplay("split-rows", "split-view");
    await expect($('[data-split-layout="rows"]')).toBeExisting();
    await expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    await browser.saveScreenshot(join(workDir(), "split-rows.png"));

    await browser.keys(ESCAPE_KEY);
    await browser.execute(() => (document.querySelector("[data-split-layout] > div:first-child [data-pan-scroller]") as HTMLElement).focus());
    await browser.keys([CONTROL_KEY, SHIFT_KEY, "e"]);
    await browser.keys([CONTROL_KEY, SHIFT_KEY]);
    await pane().waitForExist({ reverse: true, timeoutMsg: "the shortcut did not close the split" });
    await expect($("[data-split-layout]")).not.toBeExisting();

    await browser.keys([CONTROL_KEY, SHIFT_KEY, "e"]);
    await browser.keys([CONTROL_KEY, SHIFT_KEY]);
    await pane().waitForDisplayed({ timeoutMsg: "the shortcut did not reopen the split" });
    await expect($('[data-split-layout="rows"]')).toBeExisting();
  });
});
