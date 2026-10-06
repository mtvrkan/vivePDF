import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseOption, copyFixture, fixtures, openInViewer, openTool, t, waitForDialogsAnswered, workDir } from "../support/app.ts";

const region = (name: string) => $(`[data-testid="home-region-${name}"]`);
const quickTiles = () => $$(`[data-testid="home-region-main"] [data-quick-action], [data-testid="home-region-top"] [data-quick-action]`).map((tile) => tile.getAttribute("data-quick-action"));

async function startEditing() {
  await openTool("palette.action.editHome");
  await $(`//button[normalize-space(.)="${t("home.layout.done")}"]`).waitForDisplayed({ timeout: 30000 });
}

const collectionOrder = () => $$("[data-collection]").map((card) => card.getAttribute("data-collection"));

async function createCollection(name: string, paths: string[]) {
  const create = $(`//button[normalize-space(.)="${t("home.collections.create")}" or normalize-space(.)="${t("home.collections.new")}"]`);
  await create.scrollIntoView({ block: "center" });
  await create.click();
  await $(`input[placeholder="${t("home.collections.namePlaceholder")}"]`).setValue(name);
  answerDialogs(paths);
  await $(`//button[normalize-space(.)="${t("home.collections.addFiles")}"]`).click();
  await waitForDialogsAnswered();
  await $(`//button[normalize-space(.)="${t("home.collections.save")}"]`).click();
  await $(`[data-collection="${name}"]`).waitForDisplayed();
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
    const allTools = $(`//button[@aria-pressed="true"][starts-with(normalize-space(.), "${t("home.catalog.all")}")]`);
    await allTools.scrollIntoView({ block: "center" });
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "home-tool-catalogue.png"));

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
    await handle.scrollIntoView({ block: "end" });
    const { height } = await target.getSize();
    await browser
      .action("pointer")
      .move({ origin: handle })
      .down()
      .move({ origin: handle, x: 0, y: -20, duration: 100 })
      .move({ origin: target, y: Math.floor(height / 2) - 24, duration: 400 })
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

  it("drags a collection to a new place and pins another one to the front", async () => {
    const report = copyFixture(fixtures().sample, "collection-report.pdf");
    await createCollection("Drafts", [report]);
    await createCollection("Notes", [report]);
    expect(await collectionOrder()).toEqual(["Drafts", "Notes"]);

    const handle = $(`button[aria-label="${t("home.collections.dragHandle", { name: "Notes" })}"]`);
    const target = $('[data-collection="Drafts"]');
    await target.scrollIntoView({ block: "center" });
    await browser
      .action("pointer")
      .move({ origin: handle })
      .down()
      .move({ origin: handle, x: -10, y: 0, duration: 100 })
      .move({ origin: target, duration: 400 })
      .up()
      .perform();
    await browser.waitUntil(async () => (await collectionOrder()).join() === "Notes,Drafts", { timeoutMsg: "the dragged collection did not move" });

    await $(`button[aria-label="${t("home.collections.actions", { name: "Drafts" })}"]`).click();
    await $(`//*[@role="menuitem"][normalize-space(.)="${t("home.collections.pin")}"]`).click();
    expect(await collectionOrder()).toEqual(["Drafts", "Notes"]);
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "home-collections-order.png"));
  });

  it("shows what a collection holds, recolours it and opens one of its files", async () => {
    const report = copyFixture(fixtures().sample, "collection-report.pdf");
    const gone = join(workDir(), "collection-gone.pdf");
    await createCollection("Archive", [report, gone]);

    await $(`button[aria-label="${t("home.collections.viewOf", { name: "Archive" })}"]`).click();
    const view = $('[data-testid="collection-view"]');
    await view.$(`//*[normalize-space(text())="${t("home.collections.missing")}"]`).waitForDisplayed({ timeout: 15000 });
    await view.$(`button[role="radio"][aria-label="${t("viewer.tabGroups.colors.teal")}"]`).click();
    await expect(view.$(`button[role="radio"][aria-label="${t("viewer.tabGroups.colors.teal")}"]`)).toHaveAttribute("aria-checked", "true");
    await view.$(`button[role="checkbox"][aria-label="${t("home.collections.selectFile", { name: "collection-gone.pdf" })}"]`).click();
    await expect(view).toHaveText(expect.stringContaining(t("home.collections.selected", { count: 1 })));
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "home-collection-view.png"));

    await view.$(`button[aria-label="${t("home.collections.openFile", { name: "collection-report.pdf" })}"]`).click();
    await $(`//*[@role="tab"][@aria-selected="true"][.//span[@title="collection-report.pdf"]]`).waitForDisplayed({ timeout: 60000 });
  });

  it("collapses an opened collection's tab group from its name and moves the whole group like a browser", async () => {
    const first = copyFixture(fixtures().sample, "pair-a.pdf");
    const second = copyFixture(fixtures().sample, "pair-b.pdf");
    await $(`//a[normalize-space(.)="${t("nav.home")}"] | //button[normalize-space(.)="${t("nav.home")}"]`).click();
    await createCollection("Pair", [first, second]);
    await $('[data-collection="Pair"]').$(`.//button[normalize-space(.)="${t("home.collections.open")}"]`).click();

    const chip = $(`//button[@aria-expanded][starts-with(normalize-space(.), "Pair")]`);
    const pairTab = (name: string) => $(`//*[@role="tab"][.//span[normalize-space(.)="${name}"]]`);
    const tabNames = () => $$('[role="tab"]').map((tab) => tab.getText());
    await chip.waitForDisplayed({ timeout: 60000 });
    await pairTab("pair-b.pdf").waitForDisplayed({ timeout: 60000 });
    await openInViewer(copyFixture(fixtures().sample, "loose.pdf"));
    await pairTab("pair-b.pdf").click();
    await expect(pairTab("pair-b.pdf")).toHaveAttribute("aria-selected", "true");

    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(pairTab("loose.pdf")).toHaveAttribute("aria-selected", "true");
    await expect(pairTab("pair-a.pdf")).not.toBeExisting();
    await expect(pairTab("pair-b.pdf")).not.toBeExisting();
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "viewer-collection-collapsed.png"));

    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await pairTab("pair-a.pdf").waitForExist();
    expect((await tabNames()).at(-1)).toBe("loose.pdf");

    await chip.click({ button: "right" });
    await $(`//*[@role="menuitem"][normalize-space(.)="${t("viewer.tabGroups.newDocument")}"]`).waitForDisplayed();
    await expect($(`//*[@role="menuitem"][normalize-space(.)="${t("viewer.tabGroups.moveToWindow")}"]`)).toBeExisting();
    await browser.keys("Escape");

    await chip.click();
    await chip.click();
    await expect(chip).toBeFocused();
    await browser.keys(["Control", "Shift", "ArrowRight"]);
    await browser.waitUntil(async () => (await tabNames())[0] === "loose.pdf", { timeoutMsg: "the group did not move after the loose tab" });

    const loose = pairTab("loose.pdf");
    const { width } = await loose.getSize();
    await browser
      .action("pointer")
      .move({ origin: chip })
      .down()
      .move({ origin: chip, x: -10, y: 0, duration: 100 })
      .move({ origin: loose, x: -Math.floor(width / 2) + 6, y: 0, duration: 400 })
      .up()
      .perform();
    await browser.waitUntil(async () => (await tabNames()).at(-1) === "loose.pdf", { timeoutMsg: "dragging the group name did not move the group back" });
    await expect(chip).toHaveAttribute("aria-expanded", "true");
  });
});
