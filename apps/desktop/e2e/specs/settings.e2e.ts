import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { bootApp, chooseOption, clickButton, copyFixture, fixtures, openInViewer, openTool, t, typeInto, workDir } from "../support/app.ts";

const SECTIONS = ["appearance", "general", "files", "web", "viewer", "reading", "presentation", "tools", "updates", "system", "data", "feedback"];

const rail = (id: string) => $(`//nav[@aria-label="${t("nav.settings")}"]//button[.//span[normalize-space(.)="${t(`settings.sections.${id}.title`)}"]]`);
const heading = (id: string) => $(`//h2[normalize-space(.)="${t(`settings.sections.${id}.title`)}"]`);
const rowSwitch = (label: string) => $(`//div[@data-setting-row][.//span[normalize-space(.)="${label}"]]//input[@role="switch"]`);
const search = () => $(`input[aria-label="${t("settings.searchPlaceholder")}"]`);
const storedPreferences = () => browser.execute(() => JSON.parse(localStorage.getItem("vivepdf.preferences") ?? "{}") as Record<string, unknown>);

async function openSection(id: string) {
  const entry = rail(id);
  await entry.waitForClickable();
  await entry.click();
  await heading(id).waitForDisplayed({ timeout: 15000 });
  await expect(entry).toHaveAttribute("aria-current", "page");
}

async function flip(label: string, on: boolean) {
  const control = rowSwitch(label);
  await control.waitForExist();
  if ((await control.isSelected()) !== on) {
    await control.$("./ancestor::label[1]").click();
  }
  await browser.waitUntil(async () => (await control.isSelected()) === on, { timeoutMsg: `"${label}" did not turn ${on ? "on" : "off"}` });
}

async function pickRadio(group: string, option: string) {
  const choice = $(`//*[@role="radiogroup"][@aria-label="${group}"]//*[@role="radio"][normalize-space(.)="${option}" or .//*[normalize-space(.)="${option}"]]`);
  await choice.waitForClickable();
  await choice.click();
  await browser.waitUntil(async () => (await choice.getAttribute("aria-checked")) === "true", { timeoutMsg: `${group} did not select ${option}` });
}

describe("settings", () => {
  before(bootApp);

  it("opens every section from the rail", async () => {
    await openTool("nav.settings");
    for (const id of SECTIONS) {
      if (id === "system" && !(await rail(id).isExisting())) continue;
      await openSection(id);
      await expect($$(`[data-setting-row], [data-setting-tile], button`)).toBeElementsArrayOfSize({ gte: 1 });
      await browser.saveScreenshot(join(workDir(), `settings-${id}.png`));
    }
  });

  it("applies theme, scale, motion and language at once and keeps them after a reload", async () => {
    await openSection("appearance");
    await pickRadio(t("common.theme"), t("theme.dark"));
    await browser.waitUntil(() => browser.execute(() => document.documentElement.classList.contains("dark")), { timeoutMsg: "dark theme not applied" });

    const before = await browser.execute(() => getComputedStyle(document.documentElement).fontSize);
    await pickRadio(t("settings.appearance.uiScale"), "120%");
    await browser.waitUntil(async () => (await browser.execute(() => getComputedStyle(document.documentElement).fontSize)) !== before, { timeoutMsg: "interface scale not applied" });

    await flip(t("settings.appearance.reduceMotion"), false);
    await browser.waitUntil(() => browser.execute(() => document.documentElement.dataset.reduceMotion !== "true"));
    await flip(t("settings.appearance.reduceMotion"), true);
    await browser.waitUntil(() => browser.execute(() => document.documentElement.dataset.reduceMotion === "true"));

    await browser.refresh();
    await $(`nav[aria-label="${t("nav.workspace")}"]`).waitForExist({ timeout: 60000 });
    expect(await browser.execute(() => document.documentElement.classList.contains("dark"))).toBe(true);
    expect((await storedPreferences()).uiScale).toBe(120);
    await openTool("nav.settings");
    await openSection("appearance");
    await expect($(`//*[@role="radiogroup"][@aria-label="${t("settings.appearance.uiScale")}"]//*[@role="radio"][normalize-space(.)="120%"]`)).toHaveAttribute("aria-checked", "true");

    await chooseOption(t("common.language"), "Türkçe");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "tr"), { timeoutMsg: "language did not switch" });
    await expect($(`//nav//button[.//span[normalize-space(.)="Görünüm"]]`)).toBeDisplayed();
    await browser.waitUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll("header button")).every((node) => node.getBoundingClientRect().right <= window.innerWidth + 0.5)),
      { timeout: 10000, timeoutMsg: "a top bar button runs past the window at 120% in Turkish" },
    );
    await browser.saveScreenshot(join(workDir(), "settings-turkish-dark.png"));
    await chooseOption("Dil", "English");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "en"));

    await pickRadio(t("settings.appearance.uiScale"), "100%");
    await pickRadio(t("common.theme"), t("theme.light"));
    await browser.waitUntil(() => browser.execute(() => !document.documentElement.classList.contains("dark")));
  });

  it("saves a switch in another section and finds settings across sections by search", async () => {
    await openSection("general");
    await flip(t("settings.general.keepBackups"), false);
    expect((await storedPreferences()).keepBackups).toBe(false);
    await flip(t("settings.general.keepBackups"), true);
    expect((await storedPreferences()).keepBackups).toBe(true);

    await typeInto(search(), "zoom");
    await browser.waitUntil(async () => (await $$("[data-setting-row]").length) >= 2, { timeoutMsg: "search found fewer than two rows" });
    await expect(rowSwitch(t("settings.general.keepBackups"))).not.toBeExisting();
    await expect($(`//div[@data-setting-row][.//span[normalize-space(.)="${t("settings.appearance.uiZoom")}"]]`)).toBeDisplayed();
    await browser.saveScreenshot(join(workDir(), "settings-search.png"));
    await typeInto(search(), "qqqxqqq");
    await expect($(`//p[normalize-space(.)="${t("settings.noMatch")}"]`)).toBeDisplayed();
    await clickButton(t("settings.clearSearch"));
    await expect(search()).toHaveValue("");
  });

  it("counts a recently opened file under Data and clears it after confirming", async () => {
    await openSection("general");
    await flip(t("settings.general.rememberRecent"), true);
    await openInViewer(copyFixture(fixtures().sample, "settings-recent.pdf"));
    await openTool("nav.settings");
    await openSection("data");
    const count = $(`//*[normalize-space(.)="${t("settings.recentFilesCount", { count: 1 })}"]`);
    await count.waitForDisplayed({ timeout: 15000 });
    const tile = $(`(//div[.//*[normalize-space(.)="${t("settings.recentFiles")}"]][.//button])[last()]`);
    const clear = tile.$(`.//button[normalize-space(.)="${t("settings.clearRecent")}"]`);
    await clear.waitForClickable();
    await clear.click();
    const dialog = $(`[role="dialog"]`);
    await dialog.waitForDisplayed();
    await dialog.$(`.//button[normalize-space(.)="${t("settings.clearRecent")}"]`).click();
    await dialog.waitForDisplayed({ reverse: true });
    await $(`//*[normalize-space(.)="${t("settings.recentFilesCount", { count: 0 })}"]`).waitForDisplayed({ timeout: 15000 });
    await openSection("general");
    await flip(t("settings.general.rememberRecent"), false);
  });

  it("shows success messages only while that setting is on, then resets every setting after confirming", async () => {
    const copied = $(`//*[@role="status"][normalize-space(.)="${t("settings.diagnosticsCopied")}"]`);
    const copy = async () => {
      await openSection("feedback");
      await $(`//button[.//*[normalize-space(.)="${t("settings.diagnostics")}"]]`).click();
    };
    await copy();
    await browser.pause(2000);
    await expect(copied).not.toBeDisplayed();
    await openSection("general");
    await flip(t("settings.general.successToasts"), true);
    await copy();
    await copied.waitForDisplayed({ timeout: 15000 });
    await copied.waitForDisplayed({ reverse: true, timeout: 30000 });
    await openSection("general");
    await flip(t("settings.general.successToasts"), false);

    await openSection("appearance");
    await pickRadio(t("common.theme"), t("theme.dark"));
    await openSection("data");
    const resetTile = $(`(//div[.//*[normalize-space(.)="${t("settings.resetAll")}"]][.//button])[last()]`);
    await resetTile.$(`.//button[normalize-space(.)="${t("settings.resetAllAction")}"]`).click();
    const dialog = $(`[role="dialog"]`);
    await dialog.waitForDisplayed();
    await dialog.$(`.//button[normalize-space(.)="${t("settings.resetAllAction")}"]`).click();
    await browser.waitUntil(
      () => browser.execute(() => document.readyState === "complete" && document.querySelector("nav") !== null && localStorage.getItem("vivepdf.theme") === null && localStorage.getItem("vivepdf.locale") === null),
      { timeout: 60000, timeoutMsg: "theme or language survived the reset" },
    );
    expect(await browser.execute(() => localStorage.getItem("vivepdf.preferences"))).toBeNull();
  });
});
