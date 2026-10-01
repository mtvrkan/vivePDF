import { readFileSync } from "node:fs";
import { $, browser, expect } from "@wdio/globals";
import { bootApp, chooseOption, clickButton, copyFixture, fixtures, openInViewer, probe, t, typeInto } from "../support/app.ts";
import { clearClipboard, pagePoints, waitForClipboardPicture } from "../support/desktop.ts";

const ESCAPE_KEY = String.fromCharCode(0xe00c);
const CONTROL_KEY = String.fromCharCode(0xe009);
const SHIFT_KEY = String.fromCharCode(0xe008);
const DOWN_KEY = String.fromCharCode(0xe015);
const ENTER_KEY = String.fromCharCode(0xe007);

type Ink = "red" | "blue" | "green";

async function pagePixels(ink: Ink): Promise<number> {
  const page = $('[data-page-index="0"]');
  await page.waitForDisplayed();
  const png = await browser.takeElementScreenshot(await page.elementId);
  return await browser.execute(
    async (data: string, wanted: Ink) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const [red, green, blue] = [pixels[index], pixels[index + 1], pixels[index + 2]];
        if (wanted === "red" && red > 150 && green < 90 && blue < 90) count += 1;
        if (wanted === "blue" && blue > 150 && red < 90 && green < 120) count += 1;
        if (wanted === "green" && green > 110 && red < 90 && blue < 110) count += 1;
      }
      return count;
    },
    png,
    ink,
  );
}

async function waitForInk(ink: Ink, present: boolean, message: string) {
  await browser.waitUntil(async () => ((await pagePixels(ink)) > 500) === present, { timeout: 30000, interval: 500, timeoutMsg: message });
}

const layerButton = (key: string, name: string) => $(`aside[aria-label="${t("viewer.layers.title")}"] button[aria-label="${t(key, { name })}"]`);

const commentsPanel = () => $(`aside[aria-label="${t("viewer.comments.title")}"]`);
const commentRow = (text: string) => commentsPanel().$(`//li[.//p[normalize-space(.)="${text}"]]`);

const displayItem = (id: string) => $(`[role="menu"] [data-menu-id="${id}"]`);

async function openDisplayMenu() {
  await clickButton(t("viewer.pageDisplay.title"));
  await $(`[role="menu"][aria-label="${t("viewer.pageDisplay.title")}"]`).waitForDisplayed();
}

async function chooseDisplay(id: string, parent?: string) {
  await openDisplayMenu();
  if (parent) {
    await displayItem(parent).waitForClickable();
    await displayItem(parent).moveTo();
  }
  await displayItem(id).waitForClickable();
  await displayItem(id).click();
  await $(`[role="menu"][aria-label="${t("viewer.pageDisplay.title")}"]`).waitForDisplayed({ reverse: true });
}

function pageBoxes() {
  return browser.execute(() =>
    [0, 1].map((index) => {
      const rect = document.querySelector<HTMLElement>(`[data-page-index="${index}"]`)?.getBoundingClientRect();
      return rect ? { left: Math.round(rect.left), top: Math.round(rect.top) } : null;
    }),
  );
}

function scrollerOffset() {
  return browser.execute(() => {
    const scroller = document.querySelector<HTMLElement>("[data-pan-scroller]");
    return scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : { top: -1, left: -1 };
  });
}

async function toggleAutoScroll() {
  await browser.keys([CONTROL_KEY, SHIFT_KEY, "h"]);
  await browser.keys([CONTROL_KEY, SHIFT_KEY]);
}

describe("reader features", () => {
  before(async () => {
    await bootApp();
    await openInViewer(copyFixture(fixtures().six, "reader parity.pdf"));
  });

  afterEach(async () => {
    await browser.keys(ESCAPE_KEY);
  });

  it("lays the pages out horizontally and back from the page display menu", async () => {
    await chooseDisplay("scroll-horizontal");
    await browser.waitUntil(
      async () => {
        const [first, second] = await pageBoxes();
        return Boolean(first && second && first.top === second.top && second.left > first.left);
      },
      { timeoutMsg: "pages 1 and 2 are not laid out in a row" },
    );
    await openDisplayMenu();
    await expect(displayItem("scroll-horizontal")).toHaveAttribute("aria-checked", "true");
    await browser.keys(ESCAPE_KEY);

    await chooseDisplay("scroll-vertical");
    await browser.waitUntil(
      async () => {
        const [first, second] = await pageBoxes();
        return Boolean(first && second && second.top > first.top);
      },
      { timeoutMsg: "pages 1 and 2 are not one under the other again" },
    );
  });

  it("scrolls on its own, speeds up on request and stops on Escape", async () => {
    const start = (await scrollerOffset()).top;
    await toggleAutoScroll();
    await browser.waitUntil(async () => (await scrollerOffset()).top > start + 40, { timeout: 5000, timeoutMsg: "automatic scrolling did not move the pages" });
    await openDisplayMenu();
    await expect(displayItem("auto-scroll")).toHaveAttribute("aria-checked", "true");
    await browser.keys(ESCAPE_KEY);
    await browser.keys(DOWN_KEY);
    const before = (await scrollerOffset()).top;
    await browser.pause(1000);
    const moved = (await scrollerOffset()).top - before;
    expect(moved).toBeGreaterThan(50);
    await browser.keys(ESCAPE_KEY);
    await browser.pause(300);
    const stopped = (await scrollerOffset()).top;
    await browser.pause(800);
    expect((await scrollerOffset()).top).toBe(stopped);
  });

  it("recolours the pages and remembers the last scheme for the rail switch", async () => {
    const colors = () => $("[data-page-colors]").getAttribute("data-page-colors");
    await chooseDisplay("page-colors-yellowOnBlack", "page-colors");
    await expect($("[data-page-colors]")).toHaveAttribute("data-page-colors", "yellowOnBlack");
    const filter = await browser.execute(() => getComputedStyle(document.querySelector("[data-page-bitmap]") as HTMLElement).filter);
    expect(filter).toContain("vivepdf-page-colors-yellowOnBlack");
    await expect($("#vivepdf-page-colors-yellowOnBlack")).toBeExisting();

    await clickButton(t("viewer.pageDisplay.pageColors"));
    await browser.waitUntil(async () => (await colors()) === "normal", { timeoutMsg: "the rail switch did not restore the original colours" });
    await clickButton(t("viewer.pageDisplay.pageColors"));
    await browser.waitUntil(async () => (await colors()) === "yellowOnBlack", { timeoutMsg: "the rail switch did not bring back the last scheme" });
    await chooseDisplay("page-colors-normal", "page-colors");
    await expect($("[data-page-colors]")).toHaveAttribute("data-page-colors", "normal");
  });

  it("darkens text pages but keeps photos and dark covers in their own colours", async () => {
    await openInViewer(copyFixture(fixtures().covers, "reader covers.pdf"));
    await chooseDisplay("page-colors-dark", "page-colors");
    const tone = (index: number) => $(`[data-page-index="${index}"] [data-page-bitmap]`);
    await browser.waitUntil(async () => (await tone(0).getAttribute("data-page-tone")) === "pictures", { timeout: 30000, timeoutMsg: "the photo on the light page was not kept" });
    const pageFilter = await browser.execute(() => getComputedStyle(document.querySelector('[data-page-index="0"] [data-page-bitmap]') as HTMLElement).filter);
    expect(pageFilter).toContain("vivepdf-dark-page-");
    const stageFilter = await browser.execute(() => getComputedStyle(document.querySelector("[data-page-colors]") as HTMLElement).filter);
    expect(stageFilter).toBe("none");
    await browser.execute(() => document.querySelector('[data-page-index="1"]')?.scrollIntoView({ block: "start" }));
    await browser.waitUntil(async () => (await tone(1).isExisting()) && (await tone(1).getAttribute("data-page-tone")) === "dark", { timeout: 30000, timeoutMsg: "the dark cover was inverted" });
    const coverFilter = await browser.execute(() => getComputedStyle(document.querySelector('[data-page-index="1"] [data-page-bitmap]') as HTMLElement).filter);
    expect(coverFilter).toBe("none");
    await chooseDisplay("page-colors-normal", "page-colors");
  });

  it("keeps the message bar away from an unsigned document without fields", async () => {
    await expect($(`//*[@role="status"][contains(normalize-space(.), "${t("viewer.messages.dismiss")}")]`)).not.toBeExisting();
    await expect($(`button[aria-label="${t("viewer.signatures.title")}"]`)).not.toBeExisting();
    await expect($(`//button[normalize-space(.)="${t("viewer.messages.signatures.panel")}"]`)).not.toBeExisting();
  });

  it("reports the signatures of a signed document and lists them in the signature panel", async () => {
    await openInViewer(copyFixture(fixtures().signed, "reader signed.pdf"));
    const message = $(`//*[@role="status"][.//*[normalize-space(text())="${t("viewer.messages.signatures.attention")}"]]`);
    await message.waitForDisplayed({ timeout: 30000, timeoutMsg: "the signature message never appeared" });
    await clickButton(t("viewer.messages.signatures.panel"));
    const panel = $(`aside[aria-label="${t("viewer.signatures.title")}"]`);
    await panel.waitForDisplayed();
    await expect(panel).toHaveText(expect.stringContaining("Fixture Signer"));
    await expect($(`button[aria-label="${t("viewer.signatures.title")}"]`)).toHaveAttribute("aria-pressed", "true");
    await message.$(`button[aria-label="${t("viewer.messages.dismiss")}"]`).click();
    await message.waitForDisplayed({ reverse: true });
    await clickButton(t("viewer.signatures.title"));
    await panel.waitForDisplayed({ reverse: true });
  });

  it("highlights the fillable fields of a form where they are on the page", async () => {
    await openInViewer(copyFixture(fixtures().form, "reader form.pdf"));
    const message = $(`//*[@role="status"][.//*[normalize-space(text())="${t("viewer.messages.forms.present")}"]]`);
    await message.waitForDisplayed();
    await clickButton(t("viewer.messages.forms.highlight"));
    const box = $('[data-field-box="fullName"]');
    await box.waitForDisplayed({ timeout: 20000, timeoutMsg: "the field was not highlighted" });
    const [topLeft, bottomRight] = await pagePoints(0, [
      [72, 150],
      [400, 180],
    ]);
    const drawn = await browser.execute(() => {
      const rect = (document.querySelector('[data-field-box="fullName"]') as HTMLElement).getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    expect(Math.abs(drawn.left - topLeft.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(drawn.top - topLeft.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(drawn.right - bottomRight.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(drawn.bottom - bottomRight.y)).toBeLessThanOrEqual(3);
    await clickButton(t("viewer.messages.forms.highlight"));
    await box.waitForDisplayed({ reverse: true });
  });

  it("answers a comment, sets its review status and writes both into the file on save", async () => {
    const path = copyFixture(fixtures().commented, "reader comments.pdf");
    await openInViewer(path);
    await clickButton(t("viewer.comments.title"));
    const question = commentRow("Is the figure right?");
    await question.waitForDisplayed({ timeout: 20000, timeoutMsg: "the note never reached the comments panel" });

    await question.$(`button[aria-label="${t("viewer.comments.reply")}"]`).click();
    const box = question.$(`textarea[aria-label="${t("viewer.comments.replyTo", { name: "Ayşe" })}"]`);
    await box.waitForDisplayed();
    await typeInto(box, "Yes, checked against the table");
    await browser.keys([CONTROL_KEY, ENTER_KEY]);
    await browser.keys([CONTROL_KEY]);
    const answer = commentRow("Yes, checked against the table");
    await answer.waitForDisplayed();
    await expect(answer).toHaveAttribute("data-comment-depth", "1");
    await expect(answer).toHaveText(expect.stringContaining(t("viewer.pending.unsaved")));

    await question.$(`button[aria-label="${t("viewer.comments.status")}"]`).click();
    const accepted = $('[role="menu"] [data-menu-id="status-Accepted"]');
    await accepted.waitForClickable();
    await accepted.click();
    await expect(question.$('[data-comment-state="Accepted"]')).toHaveText(t("viewer.comments.states.Accepted"));

    await chooseOption(t("viewer.comments.filterReplies"), t("viewer.comments.withoutReplies"));
    await question.waitForDisplayed({ reverse: true });
    await expect(commentRow("Check the totals")).toBeDisplayed();
    await chooseOption(t("viewer.comments.filterReplies"), t("viewer.comments.filterReplies"));
    await chooseOption(t("viewer.comments.filterStatus"), t("viewer.comments.states.Accepted"));
    await expect(question).toBeDisplayed();
    await expect(commentRow("Check the totals")).not.toBeDisplayed();
    await chooseOption(t("viewer.comments.filterStatus"), t("viewer.comments.filterStatus"));

    await clickButton(t("viewer.save.save"));
    await browser.waitUntil(
      () => {
        const saved = probe(path).comments ?? [];
        return saved.some((entry) => entry.replyTo === "Is the figure right?" && entry.content === "Yes, checked against the table");
      },
      { timeout: 30000, timeoutMsg: "the reply was not written into the file" },
    );
    const saved = probe(path).comments ?? [];
    expect(saved.find((entry) => entry.content === "Is the figure right?")?.state).toBe("Accepted");
    expect(saved.find((entry) => entry.content === "Check the totals")?.state).toBeNull();
    await browser.waitUntil(async () => !(await answer.getText()).includes(t("viewer.pending.unsaved")), { timeout: 20000, timeoutMsg: "the reply still shows as unsaved after saving" });
    await expect(answer).toHaveAttribute("data-comment-depth", "1");
    await clickButton(t("viewer.comments.title"));
  });

  it("switches document layers on and off in the view without touching the file", async () => {
    const path = copyFixture(fixtures().layered, "reader layers.pdf");
    const original = readFileSync(path);
    await openInViewer(path);
    await clickButton(t("viewer.layers.title"));
    const panel = $(`aside[aria-label="${t("viewer.layers.title")}"]`);
    await panel.waitForDisplayed({ timeout: 20000, timeoutMsg: "the layers panel did not open" });
    await expect(panel).toHaveText(expect.stringContaining("Services"));
    await expect(layerButton("viewer.layers.hide", "Walls")).toHaveAttribute("aria-pressed", "true");
    await expect(layerButton("viewer.layers.show", "Plumbing")).toHaveAttribute("aria-pressed", "false");
    await waitForInk("blue", true, "the Wiring layer was not drawn at first");
    await waitForInk("green", false, "the Plumbing layer was drawn although it starts hidden");

    await layerButton("viewer.layers.hide", "Wiring").click();
    await layerButton("viewer.layers.show", "Wiring").waitForDisplayed({ timeout: 30000, timeoutMsg: "the Wiring switch did not turn off" });
    await waitForInk("blue", false, "the Wiring layer stayed on the page");
    await waitForInk("red", true, "the Walls layer disappeared with Wiring");

    await layerButton("viewer.layers.show", "Plumbing").click();
    await layerButton("viewer.layers.hide", "Plumbing").waitForDisplayed({ timeout: 30000, timeoutMsg: "the Plumbing switch did not turn on" });
    await waitForInk("green", true, "the Plumbing layer was not drawn");
    await waitForInk("blue", false, "Wiring came back when Plumbing was shown");

    await clickButton(t("viewer.layers.reset"));
    await layerButton("viewer.layers.hide", "Wiring").waitForDisplayed({ timeout: 30000, timeoutMsg: "reset did not bring Wiring back" });
    await waitForInk("blue", true, "Wiring was not drawn after the reset");
    await waitForInk("green", false, "Plumbing stayed after the reset");
    expect(readFileSync(path).equals(original)).toBe(true);
    await clickButton(t("viewer.layers.title"));
  });

  it("copies an area drawn with the toolbar snapshot as a picture", async () => {
    await openInViewer(copyFixture(fixtures().illustrated, "reader snapshot.pdf"));
    clearClipboard();
    await clickButton(t("viewer.snapshot.tool"));
    await expect($(`//*[normalize-space(text())="${t("viewer.snapshot.hint")}"]`)).toBeDisplayed();
    const [start, end] = await pagePoints(0, [
      [72, 330],
      [492, 394],
    ]);
    await browser.pause(800);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(start)
      .down()
      .move({ ...end, duration: 300 })
      .up()
      .perform();
    const picture = await waitForClipboardPicture("toolbar snapshot");
    expect(picture.width).toBeGreaterThanOrEqual(840);
    expect(picture.width / picture.height).toBeCloseTo(420 / 64, 0);
    await expect($(`//*[normalize-space(text())="${t("viewer.snapshot.hint")}"]`)).not.toBeDisplayed();
  });
});
