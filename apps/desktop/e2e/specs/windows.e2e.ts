import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, copyFixture, fixtures, openInViewer, openTool, pressShortcut, t, waitForDialogsAnswered } from "../support/app.ts";
import { glide, nativeMouse, placeWindow, screenEdgeOf, screenPointOf, windowFrame, type ScreenPoint } from "../support/desktop.ts";

async function waitForWindows(count: number) {
  await browser.waitUntil(async () => (await browser.getWindowHandles()).length === count, {
    timeout: 60000,
    timeoutMsg: `expected ${count} windows`,
  });
  return browser.getWindowHandles();
}

const pageNumber = () => $(`input[aria-label="${t("viewer.pageNumber")}"]`);
const tab = (name: string) => $(`[role="tab"][aria-selected] span[title="${name}"]`);
const tabNamed = (name: string) => $(`//*[@role="tab"][.//span[@title="${name}"]]`);
const tabNames = () => $$('[role="tab"] span[title]').map((label) => label.getAttribute("title"));
const groupChip = (name: string) => $(`//*[@role="tablist"]//button[@aria-expanded][normalize-space(.)="${name}"]`);
const otherWindow = async (main: string) => (await waitForWindows(2)).find((handle) => handle !== main) ?? "";

async function halves() {
  const frame = await windowFrame();
  const gap = Math.round(16 * frame.scale);
  const width = Math.floor((frame.work.width - gap) / 2);
  const height = Math.min(Math.round(640 * frame.scale), frame.work.height);
  return {
    frame,
    left: { x: frame.work.x, y: frame.work.y, width, height },
    right: { x: frame.work.x + width + gap, y: frame.work.y, width, height },
    drop: { x: frame.work.x + width + gap + Math.round(220 * frame.scale), y: frame.work.y + Math.round(240 * frame.scale) },
  };
}

async function nameNewGroup(tabName: string, name: string) {
  await tabNamed(tabName).click({ button: "right" });
  const addToNew = $('[role="menuitem"][data-menu-id="group-new"]');
  await addToNew.waitForDisplayed();
  await addToNew.click();
  const unnamed = groupChip(t("viewer.tabGroups.unnamed"));
  await unnamed.waitForDisplayed();
  await unnamed.doubleClick();
  const input = $(`input[aria-label="${t("viewer.tabGroups.name")}"]`);
  await input.waitForDisplayed();
  await input.setValue(name);
  await browser.keys("Enter");
  await groupChip(name).waitForDisplayed();
}

function drag(from: ScreenPoint, to: ScreenPoint) {
  nativeMouse([from, "down", ...glide(from, { x: from.x, y: from.y + 60 }, 6), ...glide({ x: from.x, y: from.y + 60 }, to), "up"]);
}

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

describe("dragging tabs between windows", () => {
  before(bootApp);

  let main = "";
  let second = "";

  it("tears a dragged tab off into a new window that opens under the pointer", async () => {
    for (const name of ["drag-a.pdf", "drag-b.pdf", "drag-c.pdf"]) await openInViewer(copyFixture(fixtures().sample, name));
    main = await browser.getWindowHandle();
    const { left, drop } = await halves();
    await placeWindow(left.x, left.y, left.width, left.height);

    drag(await screenPointOf(tabNamed("drag-b.pdf")), drop);

    second = await otherWindow(main);
    await expect(tabNamed("drag-b.pdf")).not.toBeExisting({ wait: 30000 });
    expect(await tabNames()).toEqual(["drag-a.pdf", "drag-c.pdf"]);
    await browser.switchToWindow(second);
    await tabNamed("drag-b.pdf").waitForExist({ timeout: 60000 });
    await pageNumber().waitForDisplayed({ timeout: 60000 });

    const opened = await windowFrame();
    const logical = (value: number) => value / opened.scale;
    const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
    const expectedX = clamp(logical(drop.x) - 120, logical(opened.work.x), logical(opened.work.x + opened.work.width - opened.width)) * opened.scale;
    const expectedY = clamp(logical(drop.y) - 18, logical(opened.work.y), logical(opened.work.y + opened.work.height - opened.height)) * opened.scale;
    expect(Math.abs(opened.x - expectedX)).toBeLessThanOrEqual(12 * opened.scale);
    expect(Math.abs(opened.y - expectedY)).toBeLessThanOrEqual(12 * opened.scale);
  });

  it("shows the drop line in the main window and drops the tab between the two tabs under the pointer", async () => {
    const { right } = await halves();
    await browser.switchToWindow(second);
    await placeWindow(right.x, right.y, right.width, right.height);
    await browser.switchToWindow(main);
    const target = await screenEdgeOf(tabNamed("drag-c.pdf"), "left");
    const targetLeft = await browser.execute((element) => (element as HTMLElement).getBoundingClientRect().left, await tabNamed("drag-c.pdf"));
    await browser.switchToWindow(second);
    const start = await screenPointOf(tabNamed("drag-b.pdf"));

    try {
      nativeMouse([start, "down", ...glide(start, { x: start.x, y: start.y + 60 }, 6), ...glide({ x: start.x, y: start.y + 60 }, target)]);
      await browser.switchToWindow(main);
      const line = $('[data-drop-line="remote"]');
      await line.waitForExist({ timeout: 10000, timeoutMsg: "the main window never showed the drop line" });
      const lineLeft = await browser.execute((element) => (element as HTMLElement).getBoundingClientRect().left, await line);
      expect(Math.abs(lineLeft - targetLeft)).toBeLessThanOrEqual(12);
    } finally {
      nativeMouse(["up"]);
    }

    await browser.switchToWindow(main);
    await waitForWindows(1);
    await browser.waitUntil(async () => (await tabNames()).join() === "drag-a.pdf,drag-b.pdf,drag-c.pdf", {
      timeout: 30000,
      timeoutMsg: "the dropped tab did not land between the two tabs",
    });
    await expect($('[data-drop-line="remote"]')).not.toBeExisting();
    await expect(tab("drag-b.pdf")).toBeExisting();
  });

  it("moves a dragged-out tab group into a new window and a named group back to the end of the main window", async () => {
    await nameNewGroup("drag-a.pdf", "Pack");
    const { right, drop } = await halves();
    drag(await screenPointOf(groupChip("Pack")), drop);

    second = await otherWindow(main);
    await expect(tabNamed("drag-a.pdf")).not.toBeExisting({ wait: 30000 });
    await expect(groupChip("Pack")).not.toBeExisting();
    expect(await tabNames()).toEqual(["drag-b.pdf", "drag-c.pdf"]);
    await browser.switchToWindow(second);
    await tabNamed("drag-a.pdf").waitForExist({ timeout: 60000 });
    await placeWindow(right.x, right.y, right.width, right.height);
    if (!(await groupChip("Pack").isExisting())) await nameNewGroup("drag-a.pdf", "Pack");

    await browser.switchToWindow(main);
    const target = await screenEdgeOf(tabNamed("drag-c.pdf"), "right");
    await browser.switchToWindow(second);
    drag(await screenPointOf(groupChip("Pack")), target);

    await browser.switchToWindow(main);
    await waitForWindows(1);
    await browser.waitUntil(async () => (await tabNames()).join() === "drag-b.pdf,drag-c.pdf,drag-a.pdf", {
      timeout: 30000,
      timeoutMsg: "the dropped group did not land after the last tab",
    });
    await expect(groupChip("Pack")).toBeDisplayed();
  });
});
