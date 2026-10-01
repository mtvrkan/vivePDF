import { $, browser, expect } from "@wdio/globals";
import { bootApp, clickButton, copyFixture, fixtures, openInViewer, t } from "../support/app.ts";

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
});
