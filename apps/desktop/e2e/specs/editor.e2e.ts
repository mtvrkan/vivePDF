import { basename, dirname, join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { answerDialogs, bootApp, chooseOption, clickButton, closeAllDocuments, copyFixture, ENTER_KEY, fixtures, openInViewer, probe, t, typeInto, waitForDialogsAnswered, workDir, type PageProbe } from "../support/app.ts";
import { pagePoint, pagePoints } from "../support/desktop.ts";

const END_KEY = String.fromCharCode(0xe010);
const ESCAPE_KEY = String.fromCharCode(0xe00c);
const TURNED_WIDTH = 760;
const DRAG_ATTEMPTS = 3;
const NEW_TEXT_LINE_HEIGHT = 1.25;

type Span = PageProbe["spans"][number];
type Frame = { key: string; left: number; top: number; width: number; height: number };

function pendingCount(count: number) {
  return $(`//span[normalize-space(.)="${t("viewer.overlay.pending", { count })}"]`);
}

async function waitForPending(count: number) {
  await pendingCount(count).waitForDisplayed({ timeout: 15000, timeoutMsg: `the editor never counted ${count} pending changes` });
}

async function chooseEditorItem(menuKey: "viewer.overlay.insert" | "viewer.overlay.moreTools", itemKey: string) {
  const trigger = $(`//*[@data-overlay-bar]//button[normalize-space(.)="${t(menuKey)}"]`);
  if (!(await trigger.isDisplayed())) await clickButton(t("viewer.overlay.editMenu"));
  await trigger.waitForClickable();
  await trigger.click();
  const item = $(`//*[@role="menu"]//button[normalize-space(.)="${t(itemKey)}"]`);
  await item.waitForClickable();
  await item.click();
}

async function enterEditor(target: "viewer.overlay.editTexts" | "viewer.overlay.editImages") {
  await clickButton(t("viewer.overlay.editMenu"));
  if (target === "viewer.overlay.editImages") await $(`//*[@role="group"][@aria-label="${t("viewer.overlay.editTarget")}"]//button[normalize-space(.)="${t(target)}"]`).click();
  await $(`[data-page-index="0"] [data-block-kind]`).waitForExist({ timeout: 30000, timeoutMsg: "the page blocks never loaded" });
  await waitForSteadyPage();
}

async function pageBox(): Promise<string> {
  return browser.execute(() => {
    const box = document.querySelector('[data-page-index="0"]')?.getBoundingClientRect();
    return box ? [box.left, box.top, box.width, box.height].map(Math.round).join(",") : "";
  });
}

async function waitForSteadyPage() {
  let last = "";
  await browser.waitUntil(
    async () => {
      const current = await pageBox();
      const steady = current !== "" && current === last;
      last = current;
      return steady;
    },
    { interval: 250, timeoutMsg: "the page kept moving after the editor opened" },
  );
}

async function clickPage(pageIndex: number, x: number, y: number, pageWidth?: number) {
  const point = await pagePoint(pageIndex, x, y, pageWidth);
  await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
}

async function dragPage(pageIndex: number, from: [number, number], to: [number, number], pageWidth?: number) {
  const pageBox = () => $(`[data-page-index="${pageIndex}"]`).getSize();
  for (let attempt = 0; attempt < DRAG_ATTEMPTS; attempt += 1) {
    const [start, end] = await pagePoints(pageIndex, [from, to], pageWidth);
    const before = await pageBox();
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(start)
      .down()
      .move({ ...end, duration: 300 })
      .up()
      .perform();
    const after = await pageBox();
    if (before.width === after.width && before.height === after.height) return;
  }
  throw new Error(`page ${pageIndex + 1} kept resizing while it was dragged on`);
}

async function widenBlock(by: number) {
  const handle = await browser.execute(() => {
    const rect = (document.querySelector("[data-resize-handle]") as HTMLElement).getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  });
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", ...handle })
    .down()
    .move({ origin: "viewport", x: handle.x + by, y: handle.y, duration: 300 })
    .up()
    .perform();
}

async function typeText(text: string) {
  await $("[data-editor-input]").waitForDisplayed({ timeout: 10000, timeoutMsg: "the text editor never opened" });
  await browser.keys(text);
  await browser.keys(ESCAPE_KEY);
}

async function saveCopy(name: string): Promise<string> {
  const output = join(workDir(), name);
  answerDialogs(output);
  await clickButton(t("viewer.overlay.saveAs"));
  await waitForDialogsAnswered();
  await $(`//*[@role="tab"][@aria-selected="true"][.//span[@title="${basename(output)}"]]`).waitForDisplayed({ timeout: 60000, timeoutMsg: `the saved copy ${basename(output)} was never opened` });
  return output;
}

function spanWith(spans: Span[] | undefined, text: string): Span {
  const found = (spans ?? []).find((span) => span.text.includes(text));
  if (!found) throw new Error(`no span with "${text}" in ${JSON.stringify((spans ?? []).map((span) => span.text))}`);
  return found;
}

async function objectFrames(): Promise<Frame[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-page-index="0"] [data-layer-key]'))
      .filter((element) => !element.hasAttribute("data-block-kind"))
      .map((element) => ({ key: element.dataset.layerKey ?? "", left: parseFloat(element.style.left), top: parseFloat(element.style.top), width: parseFloat(element.style.width), height: parseFloat(element.style.height) })),
  );
}

async function framesChangeFrom(previous: Frame[], what: string): Promise<Frame[]> {
  await browser.waitUntil(async () => JSON.stringify(await objectFrames()) !== JSON.stringify(previous), { timeoutMsg: what });
  return objectFrames();
}

async function setGeometry(labelKey: string, value: string) {
  await typeInto($(`input[aria-label="${t(labelKey)}"]`), value);
  await browser.keys(ENTER_KEY);
}

function layerRows() {
  return $$('aside ul[tabindex="0"] > li');
}

function layerRow(label: string) {
  return $(`//aside//ul[@tabindex="0"]/li[.//span[contains(normalize-space(.), "${label}")]]`);
}

describe("page editor", () => {
  before(bootApp);

  beforeEach(async () => {
    await closeAllDocuments();
  });

  it("rewrites an existing paragraph in place and leaves the rest of the document alone", async () => {
    const source = copyFixture(fixtures().sample, "editor-rewrite.pdf");
    const before = probe(source);
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");

    await clickPage(0, 222, 157);
    await $("[data-editor-input]").waitForDisplayed({ timeout: 10000 });
    await browser.keys(END_KEY);
    await typeText(" jumps");
    await waitForPending(1);
    await expect($(`//aside//*[normalize-space(.)="${t("viewer.editPanel.textChanged")} · ${t("viewer.editPanel.page", { page: 1 })}"]`)).toBeExisting();

    const output = await saveCopy("editor-rewrite-saved.pdf");
    const saved = probe(output);
    const text = (saved.pages?.[0].text ?? "").replace(/\s+/g, " ");
    expect(text).toContain("The quick brown fox jumps");
    expect(text).toContain("alpha marker 1");
    expect(text).toContain("Sample page 1");
    expect(saved.pages?.[1].text).toBe(before.pages?.[1].text);
    expect(probe(source).pages?.[0].text).toBe(before.pages?.[0].text);
  });

  it("keeps the page's line spacing while a small paragraph is being edited", async () => {
    await openInViewer(copyFixture(fixtures().memo, "editor-memo.pdf"));
    await enterEditor("viewer.overlay.editTexts");

    await clickPage(0, 150, 130);
    await $("[data-editor-input]").waitForDisplayed({ timeout: 10000 });
    const layout = await browser.execute(() => {
      const editor = document.querySelector("[data-editor-input]") as HTMLElement;
      const page = document.querySelector('[data-page-index="0"]') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(editor);
      const tops = [...new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)))].sort((a, b) => a - b);
      const steps = tops.slice(1).map((top, index) => top - tops[index]);
      return { lines: tops.length, step: steps.length ? steps.reduce((sum, value) => sum + value, 0) / steps.length : 0, scale: page.getBoundingClientRect().width / 595, overflow: editor.scrollHeight - editor.clientHeight };
    });

    expect(layout.lines).toBe(8);
    expect(Math.abs(layout.step - 12 * layout.scale)).toBeLessThan(1);
    expect(layout.overflow).toBeLessThan(layout.step / 2);
    await browser.keys(END_KEY);
    await typeText(" today");
    await waitForPending(1);

    const widthField = $(`input[aria-label="${t("viewer.editPanel.geometryWidthFull")}"]`);
    await widenBlock(40);
    await widthField.waitForExist({ timeout: 5000, timeoutMsg: "the panel never showed the size of the resized paragraph" });
    const widthBefore = await widthField.getValue();
    await widenBlock(40);
    await browser.waitUntil(async () => (await widthField.getValue()) !== widthBefore, { timeout: 5000, timeoutMsg: "the width field kept the size from before the resize" });

    const spacingSelect = $(`[aria-label="${t("viewer.editPanel.lineHeight")}"]`);
    await expect(spacingSelect).toHaveText(expect.stringContaining("1.33×"));
    await chooseOption(t("viewer.editPanel.lineHeight"), "2×");
    const pitch = await browser.execute(() => {
      const box = document.querySelector<HTMLElement>("[data-block-object] > div");
      const style = box ? getComputedStyle(box) : null;
      return style ? parseFloat(style.lineHeight) / parseFloat(style.fontSize) : 0;
    });
    expect(pitch).toBeCloseTo(2, 2);
  });

  it("edits light text on a coloured background over that colour, not a dark box", async () => {
    await openInViewer(copyFixture(fixtures().banner, "editor-banner.pdf"));
    await enterEditor("viewer.overlay.editTexts");

    await clickPage(0, 150, 125);
    await $("[data-editor-input]").waitForDisplayed({ timeout: 10000 });
    const background = await browser.execute(() => getComputedStyle(document.querySelector("[data-editor-input]") as HTMLElement).backgroundColor);
    const [red, green, blue] = (background.match(/\d+/g) ?? []).map(Number);

    expect(blue).toBeGreaterThan(120);
    expect(blue - red).toBeGreaterThan(60);
    expect(green).toBeLessThan(blue);
    await browser.keys(ESCAPE_KEY);
  });

  it("erases the area drawn in crop mode instead of keeping it when asked", async () => {
    const source = copyFixture(fixtures().sample, "editor-erase-area.pdf");
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.moreTools", "viewer.overlay.crop");

    await dragPage(0, [60, 108], [320, 136]);
    await clickButton(t("viewer.overlay.eraseArea"));

    const output = join(dirname(source), `editor-erase-area-${t("viewer.overlay.erasedSuffix")}.pdf`);
    await $(`//*[@role="tab"][@aria-selected="true"][.//span[@title="${basename(output)}"]]`).waitForDisplayed({ timeout: 60000, timeoutMsg: `the erased copy ${basename(output)} was never opened` });
    const text = probe(output).pages?.[0].text ?? "";
    expect(text).not.toContain("alpha marker 1");
    expect(text).toContain("Sample page 1");
    expect(text).toContain("The quick brown fox");
    expect(probe(source).pages?.[0].text).toContain("alpha marker 1");
  });

  it("erases the area drawn on a turned page with an offset crop box", async () => {
    const source = copyFixture(fixtures().turned, "editor-erase-turned.pdf");
    const box = spanWith(probe(source).pages?.[0].spans, "Turned page marker").box;
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.moreTools", "viewer.overlay.crop");

    await dragPage(0, [box[0] - 4, box[1] - 4], [box[2] + 4, box[3] + 4], TURNED_WIDTH);
    await clickButton(t("viewer.overlay.eraseArea"));

    const output = join(dirname(source), `editor-erase-turned-${t("viewer.overlay.erasedSuffix")}.pdf`);
    await $(`//*[@role="tab"][@aria-selected="true"][.//span[@title="${basename(output)}"]]`).waitForDisplayed({ timeout: 60000, timeoutMsg: `the erased copy ${basename(output)} was never opened` });
    const page = probe(output).pages?.[0];
    expect(page?.rotation).toBe(90);
    expect(page?.text).not.toContain("Turned page marker");
    expect(page?.text).toContain("second line on the turned page");
  });

  it("blacks out the area drawn on a turned page with an offset crop box", async () => {
    const source = copyFixture(fixtures().turned, "editor-redact-turned.pdf");
    const box = spanWith(probe(source).pages?.[0].spans, "Turned page marker").box;
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.moreTools", "viewer.overlay.redact");

    await dragPage(0, [box[0] - 4, box[1] - 4], [box[2] + 4, box[3] + 4], TURNED_WIDTH);
    await clickButton(t("viewer.overlay.redactApply"));
    await clickButton(t("viewer.save.save"));

    await browser.waitUntil(() => !(probe(source).pages?.[0].text ?? "").includes("Turned page marker"), { timeout: 60000, timeoutMsg: "the blacked-out line is still in the file" });
    expect(probe(source).pages?.[0].text).toContain("second line on the turned page");
  });

  it("adds a link over the area drawn on a turned page with an offset crop box", async () => {
    const source = copyFixture(fixtures().turned, "editor-link-turned.pdf");
    const box = spanWith(probe(source).pages?.[0].spans, "Turned page marker").box;
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.moreTools", "viewer.overlay.link");

    await dragPage(0, [box[0] - 4, box[1] - 4], [box[2] + 4, box[3] + 4], TURNED_WIDTH);
    await typeInto($(`input[aria-label="${t("viewer.overlay.linkUrl")}"]`), "https://example.org/turned");
    await clickButton(t("viewer.overlay.linkAdd"));
    await clickButton(t("viewer.save.save"));

    await browser.waitUntil(() => (probe(source).pages?.[0].links ?? []).includes("https://example.org/turned"), { timeout: 60000, timeoutMsg: "the link never reached the file" });
    const [link] = probe(source).pages?.[0].linkBoxes ?? [];
    expect(Math.abs(link[0] - (box[0] - 4))).toBeLessThan(3);
    expect(Math.abs(link[1] - (box[1] - 4))).toBeLessThan(3);
    expect(Math.abs(link[2] - (box[2] + 4))).toBeLessThan(3);
    expect(Math.abs(link[3] - (box[3] + 4))).toBeLessThan(3);
  });

  it("adds new text with the size and weight chosen in the panel and saves it into the open file", async () => {
    const source = copyFixture(fixtures().sample, "editor-new-text.pdf");
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");
    await chooseOption(t("viewer.overlay.fontSize"), "24 pt");
    await clickButton(t("tools.bold"));

    await clickPage(0, 300, 520);
    await typeText("Yeni satır İğdır");
    await waitForPending(1);
    const spacing = await browser.execute(() => {
      const text = Array.from(document.querySelectorAll<HTMLElement>('[data-page-index="0"] [data-layer-key]:not([data-block-kind]) div')).find((element) => element.textContent === "Yeni satır İğdır");
      const style = text ? getComputedStyle(text) : null;
      return style ? parseFloat(style.lineHeight) / parseFloat(style.fontSize) : 0;
    });
    expect(spacing).toBeCloseTo(NEW_TEXT_LINE_HEIGHT, 2);

    await clickButton(t("viewer.overlay.save"));
    await browser.waitUntil(() => (probe(source).pages?.[0].text ?? "").includes("Yeni satır İğdır"), { timeout: 60000, timeoutMsg: "the new text never reached the open file" });
    await waitForPending(0);
    const page = probe(source).pages?.[0];
    const span = spanWith(page?.spans, "Yeni satır İğdır");
    expect(span.size).toBeCloseTo(24, 0);
    expect(span.bold).toBe(true);
    expect(Math.abs(span.box[0] - 300)).toBeLessThan(6);
    expect(span.box[1]).toBeGreaterThan(470);
    expect(span.box[3]).toBeLessThan(560);
    expect(page?.text).toContain("Sample page 1");
  });

  it("keeps unsaved new text when the user leaves the viewer and comes back", async () => {
    const source = copyFixture(fixtures().sample, "editor-leave-and-return.pdf");
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");
    await clickPage(0, 300, 520);
    await typeText("Geri dönünce burada");
    await waitForPending(1);

    await $(`//a[normalize-space(.)="${t("nav.home")}"] | //button[normalize-space(.)="${t("nav.home")}"]`).click();
    await $(`//*[@data-overlay-bar]`).waitForExist({ reverse: true, timeout: 10000, timeoutMsg: "the viewer never closed" });
    await $(`//a[normalize-space(.)="${t("nav.viewer")}"] | //button[normalize-space(.)="${t("nav.viewer")}"]`).click();

    await waitForPending(1);
    const kept = await browser.execute(() => Array.from(document.querySelectorAll<HTMLElement>('[data-page-index="0"] [data-layer-key]')).some((element) => element.textContent?.includes("Geri dönünce burada")));
    expect(kept).toBe(true);
    expect(probe(source).pages?.[0].text ?? "").not.toContain("Geri dönünce burada");
  });

  it("places a picture, sizes it from the panel, undoes and redoes, duplicates and deletes it", async () => {
    const source = copyFixture(fixtures().sample, "editor-picture.pdf");
    const before = probe(source);
    await openInViewer(source);
    await enterEditor("viewer.overlay.editImages");
    answerDialogs(fixtures().red);
    await chooseEditorItem("viewer.overlay.insert", "viewer.overlay.image");
    await waitForDialogsAnswered();
    await $(`//*[normalize-space(.)="${t("viewer.overlay.imageHint")}"]`).waitForDisplayed({ timeout: 30000 });

    await clickPage(0, 300, 500);
    await waitForPending(1);
    await $(`input[aria-label="${t("viewer.editPanel.geometryWidthFull")}"]`).waitForDisplayed();
    const placed = await objectFrames();
    await setGeometry("viewer.editPanel.geometryXFull", "100");
    const moved = await framesChangeFrom(placed, "the left edge typed in the panel did not move the picture");
    await setGeometry("viewer.editPanel.geometryYFull", "450");
    const lowered = await framesChangeFrom(moved, "the top edge typed in the panel did not move the picture");
    await setGeometry("viewer.editPanel.geometryWidthFull", "200");
    const sized = await framesChangeFrom(lowered, "the width typed in the panel did not reach the picture");
    await setGeometry("viewer.editPanel.geometryHeightFull", "150");
    const final = await framesChangeFrom(sized, "the height typed in the panel did not reach the picture");

    await clickButton(t("viewer.editPanel.undo"));
    await browser.waitUntil(async () => JSON.stringify(await objectFrames()) === JSON.stringify(sized), { timeoutMsg: "undo did not bring the previous height back" });
    await clickButton(t("viewer.editPanel.redo"));
    await browser.waitUntil(async () => JSON.stringify(await objectFrames()) === JSON.stringify(final), { timeoutMsg: "redo did not apply the height again" });

    await clickPage(0, 200, 525);
    await clickButton(t("viewer.overlay.duplicate"));
    await waitForPending(2);
    await clickButton(t("viewer.overlay.deleteObject"));
    await waitForPending(1);

    const output = await saveCopy("editor-picture-saved.pdf");
    const saved = probe(output);
    expect(saved.pages?.[0].images).toBe((before.pages?.[0].images ?? 0) + 1);
    const [box] = saved.pages?.[0].imageBoxes ?? [];
    expect(box[2] - box[0]).toBeCloseTo(200, 0);
    expect(box[3] - box[1]).toBeCloseTo(150, 0);
    expect(box[0]).toBeGreaterThanOrEqual(99);
    expect(box[0]).toBeLessThanOrEqual(113);
    expect(box[1]).toBeGreaterThanOrEqual(449);
    expect(box[1]).toBeLessThanOrEqual(463);
    expect(saved.pages?.[1].imageBoxes).toEqual(before.pages?.[1].imageBoxes);
  });

  it("filters, locks, hides and removes objects from the Layers list", async () => {
    const source = copyFixture(fixtures().sample, "editor-layers.pdf");
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");
    await clickPage(0, 300, 640);
    await typeText("Katman metni");
    await waitForPending(1);

    answerDialogs(fixtures().blue);
    await chooseEditorItem("viewer.overlay.insert", "viewer.overlay.image");
    await waitForDialogsAnswered();
    await $(`//*[normalize-space(.)="${t("viewer.overlay.imageHint")}"]`).waitForDisplayed({ timeout: 30000 });
    await clickPage(0, 300, 420);
    await waitForPending(2);

    await browser.waitUntil(async () => (await layerRows().length) === 3, { timeoutMsg: "the Layers list does not show the paragraph, the new text and the picture" });
    await clickButton(t("viewer.editPanel.layers.filterText"));
    await browser.waitUntil(async () => (await layerRows().length) === 2, { timeoutMsg: "the Text filter did not leave the two texts" });
    await clickButton(t("viewer.editPanel.layers.filterImage"));
    await browser.waitUntil(async () => (await layerRows().length) === 1, { timeoutMsg: "the Pictures filter did not leave only the picture" });
    await expect($(`//aside//button[@aria-pressed="true"][normalize-space(.)="${t("viewer.editPanel.layers.filterImage")}"]`)).toBeExisting();

    await layerRows()[0].$(`button[aria-label="${t("viewer.editPanel.layers.lock")}"]`).click();
    const lockedAt = await objectFrames();
    await dragPage(0, [300, 420], [300, 300]);
    await browser.pause(300);
    expect(await objectFrames()).toEqual(lockedAt);
    await layerRows()[0].$(`button[aria-label="${t("viewer.editPanel.layers.unlock")}"]`).click();
    await dragPage(0, [300, 420], [300, 300]);
    await framesChangeFrom(lockedAt, "the unlocked picture could not be moved");

    await clickButton(t("viewer.editPanel.layers.filterAll"));
    await browser.waitUntil(async () => (await layerRows().length) === 3, { timeoutMsg: "the All filter did not list every object again" });
    const shown = (await objectFrames()).length;
    await layerRow("Katman metni").$(`button[aria-label="${t("viewer.editPanel.layers.hide")}"]`).click();
    await browser.waitUntil(async () => (await objectFrames()).length === shown - 1, { timeoutMsg: "hiding the text did not take it off the page" });
    await layerRow("Katman metni").$(`button[aria-label="${t("viewer.editPanel.layers.show")}"]`).click();
    await browser.waitUntil(async () => (await objectFrames()).length === shown, { timeoutMsg: "showing the text did not bring it back" });

    await layerRow("Katman metni").$(`button[aria-label="${t("viewer.editPanel.revert")}"]`).click();
    await waitForPending(1);
    await expect(layerRow("Katman metni")).not.toBeExisting();
    await browser.waitUntil(async () => (await layerRows().length) === 2, { timeoutMsg: "the removed text is still listed" });

    const output = await saveCopy("editor-layers-saved.pdf");
    const saved = probe(output);
    expect(saved.pages?.[0].text).not.toContain("Katman metni");
    expect(saved.pages?.[0].images).toBe(1);
    const [box] = saved.pages?.[0].imageBoxes ?? [];
    expect((box[1] + box[3]) / 2).toBeLessThan(380);
  });

  it("opens a placed formula again on double click and saves the corrected one in its place", async () => {
    const source = copyFixture(fixtures().sample, "editor-reedit.pdf");
    const before = probe(source);
    await openInViewer(source);
    await chooseEditorItem("viewer.overlay.insert", "viewer.formula.menu");
    const area = $('[role="dialog"] textarea');
    await area.waitForDisplayed();
    await typeInto(area, "x^2");
    await $(`//div[@role="dialog"]//img[@alt='x^2']`).waitForDisplayed({ timeout: 30000 });
    await clickButton(t("viewer.formula.insert"));
    await area.waitForExist({ reverse: true });
    await clickPage(0, 300, 420);
    await waitForPending(1);

    await $('[data-page-index="0"] [data-layer-key]:not([data-block-kind])').doubleClick();
    await area.waitForDisplayed({ timeout: 10000 });
    expect(await area.getValue()).toBe("x^2");
    const corrected = String.raw`\frac{a}{b}`;
    await typeInto(area, corrected);
    await $(`//div[@role="dialog"]//img[@alt='${corrected}']`).waitForDisplayed({ timeout: 30000 });
    await clickButton(t("viewer.formula.update"));
    await area.waitForExist({ reverse: true });
    await waitForPending(1);
    await expect($(`//aside//span[normalize-space(.)="${corrected}"]`)).toBeExisting();

    const output = await saveCopy("editor-reedit-saved.pdf");
    const saved = probe(output);
    expect(saved.pages?.[0].drawings).toBeGreaterThan((before.pages?.[0].drawings ?? 0) + 2);
    expect(saved.pages?.[0].text).toContain("Sample page 1");
  });

  it("writes new text where it was clicked on a turned page with an offset crop box", async () => {
    const source = copyFixture(fixtures().turned, "editor-turned.pdf");
    const before = probe(source);
    expect(before.pages?.[0].rotation).toBe(90);
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");

    await clickPage(0, 400, 300, TURNED_WIDTH);
    await typeText("Döndürülmüş not");
    await waitForPending(1);

    const output = await saveCopy("editor-turned-saved.pdf");
    const saved = probe(output);
    expect(saved.pages?.[0].rotation).toBe(90);
    const span = spanWith(saved.pages?.[0].spans, "Döndürülmüş not");
    expect(Math.abs(span.box[0] - 400)).toBeLessThan(8);
    expect(span.box[2]).toBeGreaterThan(span.box[0] + 40);
    expect(Math.abs((span.box[1] + span.box[3]) / 2 - 300)).toBeLessThan(16);
    expect(saved.pages?.[0].text).toContain("Turned page marker");
    expect(saved.pages?.[1].text).toBe(before.pages?.[1].text);
  });

  it("writes new text under the pointer after the view is turned a quarter", async () => {
    const source = copyFixture(fixtures().sample, "editor-view-turned.pdf");
    await openInViewer(source);
    await clickButton(t("viewer.rotate"));
    await waitForSteadyPage();
    await enterEditor("viewer.overlay.editTexts");

    const [point] = await pagePoints(0, [[842 - 520, 300]], 842);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down().up().perform();
    await typeText("Yan görünüm notu");
    await waitForPending(1);

    const output = await saveCopy("editor-view-turned-saved.pdf");
    const page = probe(output).pages?.[0];
    expect(page?.rotation).toBe(0);
    const span = spanWith(page?.spans, "Yan görünüm notu");
    expect(Math.abs(span.box[0] - 300)).toBeLessThan(8);
    expect(Math.abs((span.box[1] + span.box[3]) / 2 - 520)).toBeLessThan(16);
  });

  it("moves a picture that was already in the file, then deletes it from the saved copy", async () => {
    const source = copyFixture(fixtures().illustrated, "editor-existing-picture.pdf");
    const before = probe(source);
    const [original] = before.pages?.[0].imageBoxes ?? [];
    await openInViewer(source);
    await enterEditor("viewer.overlay.editImages");
    await $(`[data-page-index="0"] [data-block-kind="image"]`).waitForExist({ timeout: 30000 });

    const middle: [number, number] = [(original[0] + original[2]) / 2, (original[1] + original[3]) / 2];
    await dragPage(0, middle, [middle[0], middle[1] + 120]);
    await waitForPending(1);
    await expect($(`//aside//*[normalize-space(.)="${t("viewer.editPanel.imageMoved")} · ${t("viewer.editPanel.page", { page: 1 })}"]`)).toBeExisting();

    const moved = await saveCopy("editor-existing-moved.pdf");
    const movedPage = probe(moved).pages?.[0];
    const [movedBox] = movedPage?.imageBoxes ?? [];
    expect(Math.abs(movedBox[1] - (original[1] + 120))).toBeLessThan(10);
    expect(movedBox[2] - movedBox[0]).toBeCloseTo(original[2] - original[0], 0);
    expect(movedPage?.text).toContain("Menu check first line");

    await enterEditor("viewer.overlay.editImages");
    await $(`[data-page-index="0"] [data-block-kind="image"]`).waitForExist({ timeout: 30000 });
    await clickPage(0, (movedBox[0] + movedBox[2]) / 2, (movedBox[1] + movedBox[3]) / 2);
    await clickButton(t("viewer.overlay.deleteImage"));
    await waitForPending(1);
    const deleted = await saveCopy("editor-existing-deleted.pdf");
    const deletedPage = probe(deleted).pages?.[0];
    expect(deletedPage?.imageBoxes).toEqual([]);
    expect(deletedPage?.text).toContain("Menu check first line");
  });

  it("keeps the layers of a layered PDF when text is added to it", async () => {
    const source = copyFixture(fixtures().layered, "editor-layered.pdf");
    const before = probe(source);
    expect(before.layers).toBe(3);
    await openInViewer(source);
    await enterEditor("viewer.overlay.editTexts");
    await clickPage(0, 300, 700);
    await typeText("Katmanlı belge notu");
    await waitForPending(1);

    const output = await saveCopy("editor-layered-saved.pdf");
    const saved = probe(output);
    expect(saved.layers).toBe(3);
    expect((saved.pages?.[0].text ?? "").replace(/\s+/g, " ")).toContain("Katmanlı belge notu");
    expect(saved.pages?.[0].drawings).toBe(before.pages?.[0].drawings);
  });
});
