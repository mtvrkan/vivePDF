import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { bootApp, chooseOption, openTool, t } from "../support/app.ts";

const region = (name: string) => $(`[data-testid="home-region-${name}"]`);
const quickTiles = () => $$(`[data-testid="home-region-main"] [data-quick-action], [data-testid="home-region-top"] [data-quick-action]`).map((tile) => tile.getAttribute("data-quick-action"));

async function startEditing() {
  await openTool("palette.action.editHome");
  await $(`//button[normalize-space(.)="${t("home.layout.done")}"]`).waitForDisplayed({ timeout: 30000 });
}

async function finishEditing() {
  await $(`//button[normalize-space(.)="${t("home.layout.done")}"]`).click();
  await $(`//button[normalize-space(.)="${t("home.layout.edit")}"]`).waitForDisplayed();
}

describe("home layout", () => {
  before(bootApp);

  it("moves, resizes and hides sections, edits quick access and keeps it after a restart of the page", async () => {
    await startEditing();
    const recent = t("home.recent");
    const stats = t("home.stats.title");

    await chooseOption(t("home.layout.regionOf", { name: recent }), t("home.layout.regions.top"));
    await $(`button[aria-label="${t("home.layout.hide", { name: stats })}"]`).click();
    await region("side").$('[data-hidden-section="stats"]').waitForDisplayed();
    await $(`//*[@data-testid="home-frame-quickActions"]//*[@role="radio"][normalize-space(.)="${t("home.layout.sizes.large")}"]`).click();
    await $(`button[aria-label="${t("home.layout.quick.remove", { name: t("nav.merge") })}"]`).click();
    await $(`//button[normalize-space(.)="${t("home.layout.quick.add")}"]`).click();
    const ocrCard = $(`//*[@role="dialog"]//button[.//span[normalize-space(text())="${t("nav.ocr")}"]]`);
    await ocrCard.waitForClickable();
    await ocrCard.click();
    await browser.waitUntil(async () => (await ocrCard.getAttribute("aria-pressed")) === "true");
    await browser.keys("Escape");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "home-editing.png"));
    await finishEditing();

    await expect(region("top")).toHaveText(expect.stringContaining(recent), { ignoreCase: true });
    await expect(region("side")).not.toHaveText(expect.stringContaining(stats), { ignoreCase: true });
    let tiles = await quickTiles();
    expect(tiles).toContain("ocr");
    expect(tiles).not.toContain("merge");
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "home-custom.png"));

    await browser.refresh();
    await region("top").waitForDisplayed({ timeout: 60000 });
    await expect(region("top")).toHaveText(expect.stringContaining(recent), { ignoreCase: true });
    tiles = await quickTiles();
    expect(tiles).toContain("ocr");
  });

  it("drags a section into another column and resets everything with undo", async () => {
    await startEditing();
    const history = t("home.history.title");
    const handle = $(`button[aria-label="${t("home.layout.dragHandle", { name: history })}"]`);
    const target = $(`[data-testid="home-region-top"]`);
    await browser.execute(() => document.querySelector('[data-testid="home-region-top"]')?.scrollIntoView({ block: "start" }));
    await browser
      .action("pointer")
      .move({ origin: handle })
      .down()
      .move({ origin: handle, x: 0, y: 20, duration: 100 })
      .move({ origin: target, duration: 400 })
      .up()
      .perform();
    await expect(target).toHaveText(expect.stringContaining(history), { ignoreCase: true });

    await $(`//button[normalize-space(.)="${t("home.layout.reset")}"]`).click();
    await expect(region("top")).not.toHaveText(expect.stringContaining(t("home.recent")), { ignoreCase: true });
    await expect(target).not.toHaveText(expect.stringContaining(history), { ignoreCase: true });
    await expect(region("side")).toHaveText(expect.stringContaining(history), { ignoreCase: true });
    await finishEditing();
    expect(await quickTiles()).toContain("merge");
  });

  it("drags a quick access tile onto another one and shows Studio on the home page", async () => {
    await expect($('[data-testid="home-studio"]')).toBeDisplayed();
    await startEditing();
    const merge = $(`[data-testid="home-region-main"] [data-quick-action="merge"] > div`);
    const compress = $(`[data-testid="home-region-main"] [data-quick-action="compress"] > div`);
    await merge.scrollIntoView({ block: "center" });
    await browser
      .action("pointer")
      .move({ origin: merge })
      .down()
      .move({ origin: merge, x: 10, y: 0, duration: 100 })
      .move({ origin: compress, duration: 400 })
      .up()
      .perform();
    await finishEditing();

    expect((await quickTiles()).slice(0, 3)).toEqual(["split", "compress", "merge"]);
  });
});
