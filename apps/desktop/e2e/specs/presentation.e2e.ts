import { $, browser, expect } from "@wdio/globals";
import { join } from "node:path";
import { bootApp, clickButton, copyFixture, fixtures, openInViewer, t, workDir } from "../support/app.ts";

type Point = { x: number; y: number };
type Colour = "red" | "blue";

async function pagePoint(pdfX: number, pdfY: number): Promise<Point> {
  const box = await browser.execute(() => {
    const rect = (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  });
  const scale = box.width / 595;
  return { x: Math.round(box.left + pdfX * scale), y: Math.round(box.top + pdfY * scale) };
}

const ESCAPE_KEY = String.fromCharCode(0xe00c);
const ALT_KEY = String.fromCharCode(0xe00a);
const F5_KEY = String.fromCharCode(0xe035);

async function drawLine(from: Point, to: Point) {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", ...from })
    .down()
    .move({ origin: "viewport", x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2), duration: 150 })
    .move({ origin: "viewport", ...to, duration: 150 })
    .up()
    .perform();
}

function strokeCanvasReach() {
  return browser.execute(() => {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(".immersive-view canvas.pointer-events-none.absolute")).filter((canvas) => !canvas.closest("[data-page-index]"));
    const rects = canvases.map((canvas) => canvas.getBoundingClientRect());
    return { left: Math.min(...rects.map((rect) => rect.left)), right: Math.max(...rects.map((rect) => rect.right)) };
  });
}

function drawnPixels() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLCanvasElement>(".immersive-view canvas.pointer-events-none.absolute"))
      .filter((canvas) => !canvas.closest("[data-page-index]") && canvas.width > 0 && canvas.height > 0)
      .reduce((total, canvas) => {
        const pixels = (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count += 1;
        return total + count;
      }, 0),
  );
}

type PageBox = { left: number; right: number; top: number; bottom: number };

async function redPixels(outside: PageBox | null, within: PageBox | null = null): Promise<number> {
  const png = await browser.takeScreenshot();
  return browser.execute(
    async (data: string, page: PageBox | null, area: PageBox | null) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const scale = image.naturalWidth / window.innerWidth;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (!(pixels[index] > 170 && pixels[index + 1] < 120 && pixels[index + 2] < 120)) continue;
        const pixel = index / 4;
        const x = (pixel % canvas.width) / scale;
        const y = Math.floor(pixel / canvas.width) / scale;
        if (page && x >= page.left - 4 && x <= page.right + 4) continue;
        if (area && (x < area.left || x > area.right || y < area.top || y > area.bottom)) continue;
        count += 1;
      }
      return count;
    },
    png,
    outside,
    within,
  );
}

async function hover(point: Point) {
  await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move({ origin: "viewport", ...point, duration: 100 }).perform();
}

async function lensPixels(colour: Colour): Promise<number> {
  const lens = $("[data-magnifier-lens]");
  if (!(await lens.isExisting())) return 0;
  const png = await browser.takeElementScreenshot(await lens.elementId);
  return await browser.execute(
    async (data: string, wanted: Colour) => {
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
        const hit = wanted === "red" ? red > 150 && green < 90 && blue < 90 : blue > 150 && red < 90 && green < 120;
        if (hit) count += 1;
      }
      return count;
    },
    png,
    colour,
  );
}

async function waitForLensColour(colour: Colour, near: Point) {
  let step = 0;
  await browser.waitUntil(
    async () => {
      step += 1;
      await hover({ x: near.x + (step % 2), y: near.y });
      return (await lensPixels(colour)) > 200;
    },
    { timeout: 20000, interval: 500, timeoutMsg: `magnifier lens never showed the ${colour} annotation text` },
  );
}

async function waitForStableLayout() {
  let last = "";
  await browser.waitUntil(
    async () => {
      const current = JSON.stringify(await pagePoint(0, 0));
      const settled = current === last;
      last = current;
      return settled;
    },
    { interval: 300, timeoutMsg: "presentation layout never settled" },
  );
}

describe("presentation", () => {
  before(bootApp);

  it("magnifies text annotations, including HTML text in the bundled font", async () => {
    const path = copyFixture(fixtures().annotated);
    await openInViewer(path);
    const page = $('[data-page-index="0"]');
    await page.waitForDisplayed();
    await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: "page 1 never rendered" });

    await page.click();
    await browser.keys("F11");
    const magnifier = $(`button[aria-label="${t("presentation.tools.magnifier")}"]`);
    await magnifier.waitForDisplayed({ timeout: 20000 });
    await clickButton(t("presentation.tools.magnifier"));
    await expect(magnifier).toHaveAttribute("aria-pressed", "true");
    await waitForStableLayout();

    const target = await pagePoint(150, 330);
    await waitForLensColour("red", target);

    await browser.execute(() => {
      const layer = document.querySelector('[data-page-index="0"] [data-annotation-layer]') as HTMLElement;
      const text = layer.querySelector("span") as HTMLElement;
      text.textContent = "gÇşğ Wide";
      text.style.fontFamily = '"DejaVu Sans"';
      text.style.color = "rgb(26, 60, 217)";
      (text.parentElement as HTMLElement).style.opacity = "1";
      (layer.querySelector("img") as HTMLElement).style.display = "none";
    });
    await waitForLensColour("blue", target);
    expect(await lensPixels("red")).toBeLessThan(50);
  });

  it("keeps pen strokes that run off the page or start beside it", async () => {
    await browser.keys(ESCAPE_KEY);
    await browser.keys("p");
    await waitForStableLayout();
    const page = await browser.execute(() => {
      const rect = (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const middle = Math.round((page.top + page.bottom) / 2);
    await drawLine({ x: Math.round(page.right - 80), y: middle }, { x: Math.round(page.right + 60), y: middle + 40 });
    await drawLine({ x: Math.round(page.left - 60), y: middle - 80 }, { x: Math.round(page.left - 20), y: middle - 20 });

    await browser.waitUntil(
      async () => {
        const reach = await strokeCanvasReach();
        return reach.right >= page.right + 55 && reach.left <= page.left - 55;
      },
      { timeout: 10000, timeoutMsg: "the pen strokes beside the page were not kept" },
    );
    expect(await redPixels(page)).toBeGreaterThan(40);
    await browser.saveScreenshot(join(workDir(), "pen-off-page.png"));
  });

  it("draws on a black screen and says how to leave it", async () => {
    await browser.keys("b");
    const board = $('[data-presentation-board="black"]');
    await board.waitForDisplayed();
    await expect(board.$('[role="status"]')).toHaveText(t("presentation.boardHint"));

    await drawLine({ x: 300, y: 300 }, { x: 700, y: 360 });
    await browser.waitUntil(async () => (await redPixels(null)) > 300, { timeout: 10000, timeoutMsg: "the pen left no ink on the black screen" });
    await browser.saveScreenshot(join(workDir(), "black-board.png"));

    await browser.keys(ESCAPE_KEY);
    await expect(board).toBeDisplayed();
    await browser.keys(ESCAPE_KEY);
    await board.waitForExist({ reverse: true, timeoutMsg: "Esc did not leave the black screen" });
    await browser.keys(ESCAPE_KEY);
  });

  it("draws a rectangle and a text, then moves and deletes a drawing", async () => {
    const page = $('[data-page-index="0"]');
    if (!(await $(".immersive-view").isExisting())) {
      await page.click();
      await browser.keys("F11");
    }
    const shapeButton = $(`button[aria-label="${t("presentation.tools.shape")}"]`);
    await shapeButton.waitForDisplayed({ timeout: 20000 });
    await waitForStableLayout();
    const selection = $("[data-presentation-selection]");
    const selectionLeft = async () => (await selection.getLocation()).x;
    const clickAt = (point: Point) => browser.action("pointer", { parameters: { pointerType: "mouse" } }).move({ origin: "viewport", ...point }).down().up().perform();

    await clickButton(t("presentation.tools.shape"));
    await clickButton(t("presentation.style"));
    await clickButton(t("presentation.shapes.rect"));
    await clickButton(t("presentation.style"));
    const blank = await drawnPixels();
    await drawLine(await pagePoint(100, 100), await pagePoint(250, 200));
    await browser.waitUntil(async () => (await drawnPixels()) > blank + 500, { timeoutMsg: "the rectangle left no ink on the page" });
    const withRect = await drawnPixels();
    const corner = await pagePoint(90, 90);
    const farCorner = await pagePoint(260, 210);
    expect(await redPixels(null, { left: corner.x, top: corner.y, right: farCorner.x, bottom: farCorner.y })).toBeGreaterThan(300);

    await clickButton(t("presentation.tools.text"));
    await clickAt(await pagePoint(100, 420));
    const field = $(`textarea[aria-label="${t("presentation.tools.text")}"]`);
    await field.waitForDisplayed({ timeoutMsg: "the text tool did not open a text field" });
    await browser.keys("Merhaba");
    await browser.keys(String.fromCharCode(0xe007));
    await field.waitForExist({ reverse: true, timeoutMsg: "Enter did not place the text" });
    await browser.waitUntil(async () => (await drawnPixels()) > withRect + 300, { timeoutMsg: "the placed text left no ink on the page" });

    await browser.keys("v");
    await clickAt(await pagePoint(100, 150));
    await selection.waitForExist({ timeoutMsg: "a click on the rectangle did not select it" });
    const before = await selectionLeft();
    const edge = await pagePoint(100, 150);
    await drawLine(edge, { x: edge.x + 60, y: edge.y });
    await browser.waitUntil(async () => (await selectionLeft()) - before > 50, { timeoutMsg: "dragging the selected rectangle did not move it" });
    await browser.saveScreenshot(join(workDir(), "presentation-shapes.png"));

    await browser.keys(String.fromCharCode(0xe017));
    await selection.waitForExist({ reverse: true, timeoutMsg: "Delete did not remove the selected rectangle" });
    await clickAt({ x: edge.x + 60, y: edge.y });
    await browser.pause(300);
    expect(await selection.isExisting()).toBe(false);

    await clickAt(await pagePoint(110, 428));
    await selection.waitForExist({ timeoutMsg: "the placed text could not be selected" });
  });

  it("mirrors pages and ink to the audience window and closes it at the end", async () => {
    for (let attempt = 0; attempt < 4 && (await $(".immersive-view").isExisting()); attempt += 1) await browser.keys(ESCAPE_KEY);
    await $(".immersive-view").waitForExist({ reverse: true, timeoutMsg: "the solo presentation did not end" });
    const consoleWindow = await browser.getWindowHandle();
    await openInViewer(copyFixture(fixtures().six, "presenter-six.pdf"));
    await $('[data-page-index="0"]').waitForDisplayed();

    await browser.keys([ALT_KEY, F5_KEY]);
    await browser.keys([ALT_KEY]);
    const presentAnyway = $(`button=${t("presentation.presenter.presentAnyway")}`);
    if (await presentAnyway.isExisting()) await presentAnyway.click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, { timeout: 30000, timeoutMsg: "Alt+F5 did not open the audience window" });
    const audience = (await browser.getWindowHandles()).find((handle) => handle !== consoleWindow) as string;
    await $(`[role="region"][aria-label="${t("presentation.presenter.console")}"]`).waitForDisplayed({ timeout: 20000 });

    const audiencePage = () =>
      browser.execute(() => {
        const middle = window.innerHeight / 2;
        const page = Array.from(document.querySelectorAll<HTMLElement>("[data-page-index]")).find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top <= middle && rect.bottom >= middle;
        });
        return page ? Number(page.dataset.pageIndex) : -1;
      });
    await browser.switchToWindow(audience);
    await browser.waitUntil(async () => (await audiencePage()) === 0, { timeout: 30000, timeoutMsg: "the audience window never showed page 1" });

    await browser.switchToWindow(consoleWindow);
    await clickButton(t("presentation.presenter.nextPage", { page: 2 }));
    await browser.switchToWindow(audience);
    await browser.waitUntil(async () => (await audiencePage()) === 1, { timeout: 10000, timeoutMsg: "the audience window did not follow to page 2" });
    const blank = await redPixels(null);

    await browser.switchToWindow(consoleWindow);
    await browser.keys("p");
    const stage = await browser.execute(() => {
      const middle = window.innerHeight / 2;
      const page = Array.from(document.querySelectorAll<HTMLElement>(".immersive-view [data-page-index]")).find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      }) as HTMLElement;
      const rect = page.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await drawLine(
      { x: Math.round(stage.left + stage.width * 0.2), y: Math.round(stage.top + stage.height * 0.4) },
      { x: Math.round(stage.left + stage.width * 0.7), y: Math.round(stage.top + stage.height * 0.5) },
    );
    await browser.switchToWindow(audience);
    await browser.waitUntil(async () => (await redPixels(null)) > blank + 200, { timeout: 10000, timeoutMsg: "the stroke did not reach the audience window" });
    await browser.saveScreenshot(join(workDir(), "presenter-audience.png"));

    await browser.switchToWindow(consoleWindow);
    await browser.saveScreenshot(join(workDir(), "presenter-console.png"));
    await clickButton(t("presentation.presenter.end"));
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, { timeout: 20000, timeoutMsg: "ending the presentation left the audience window open" });
    await $(".immersive-view").waitForExist({ reverse: true, timeoutMsg: "the console did not leave presenter view" });
  });
});
