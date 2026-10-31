import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, query = "lang=en"): Promise<void> {
  await page.goto(`/e2e/playground.html?${query}`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");

test("the page box jumps to a typed page and clamps past the end", async ({ page }) => {
  await openViewer(page);
  const pageBox = viewer(page).getByRole("textbox", { name: "Page number" });

  await pageBox.fill("250");
  await pageBox.press("Enter");

  await expect(pageBox).toHaveValue("250");
  await expect(viewer(page).locator('[data-page-index="249"]')).toBeInViewport();

  await pageBox.fill("9999");
  await pageBox.press("Enter");

  await expect(pageBox).toHaveValue("500");
});

test("zoom buttons change the shown level", async ({ page }) => {
  await openViewer(page);
  const level = viewer(page).getByRole("status").filter({ hasText: "%" });
  const before = await level.textContent();

  await viewer(page).getByRole("button", { name: "Zoom in" }).click();

  await expect(level).not.toHaveText(before ?? "");
});

test("the more menu switches to two pages and closes with Escape", async ({ page }) => {
  await openViewer(page);
  const more = viewer(page).getByRole("button", { name: "More options" });

  await more.click();
  await viewer(page).getByRole("menuitemradio", { name: "Two pages side by side" }).click();
  await more.click();

  await expect(viewer(page).getByRole("menuitemradio", { name: "Two pages side by side" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(viewer(page).getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("Turkish labels and the dark theme follow the element attributes", async ({ page }) => {
  await openViewer(page, "lang=tr&theme=dark");

  await expect(viewer(page).getByRole("button", { name: "Yakınlaştır" })).toBeVisible();
  await expect(viewer(page).locator(".vp")).toHaveAttribute("data-theme", "dark");
});

test("on touch screens the toolbar hides while the finger scrolls down, not after a jump", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the toolbar only hides on touch screens");
  await page.goto("/e2e/playground.html?lang=en");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
  const toolbar = page.getByTestId("viewer").locator(".vp-pill");

  await page.getByTestId("viewer").getByRole("textbox", { name: "Page number" }).fill("30");
  await page.getByTestId("viewer").getByRole("textbox", { name: "Page number" }).press("Enter");
  await expect(page.getByTestId("viewer").getByRole("textbox", { name: "Page number" })).toHaveValue("30");
  await expect(toolbar).toHaveAttribute("data-hidden", "false");

  await page.evaluate(async () => {
    const pages = document.querySelector("vive-pdf")?.shadowRoot?.querySelector<HTMLElement>(".vp-viewport");
    if (!pages) throw new Error("no pages");
    const point = { bubbles: true, composed: true, pointerType: "touch", clientX: 100, clientY: 400 };
    pages.dispatchEvent(new PointerEvent("pointerdown", point));
    for (let step = 1; step <= 6; step += 1) {
      pages.scrollTop += 40;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    pages.dispatchEvent(new PointerEvent("pointerup", { ...point, clientY: 160 }));
  });
  await expect(toolbar).toHaveAttribute("data-hidden", "true");
});

test("the document opens at the top of the first page", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/small.pdf");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");

  const position = () => page.evaluate(() => document.querySelector("vive-pdf")?.shadowRoot?.querySelector(".vp-viewport")?.scrollTop);

  await page.waitForTimeout(400);
  expect(await position()).toBe(0);
});

test("highlights, drawings, boxes and notes already in the PDF are drawn on the page", async ({ page }) => {
  await openViewer(page, "lang=en&src=/fixtures/annotated.pdf");
  const image = viewer(page).locator('[data-page-index="0"] img').first();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);

  const colours = await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(node, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { yellow: 0, red: 0, blue: 0 };
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
      if (red > 200 && green > 200 && blue < 120) counts.yellow += 1;
      else if (red > 200 && green < 80 && blue < 80) counts.red += 1;
      else if (blue > 200 && red < 80 && green < 80) counts.blue += 1;
    }
    return counts;
  });

  expect(colours.yellow).toBeGreaterThan(500);
  expect(colours.red).toBeGreaterThan(100);
  expect(colours.blue).toBeGreaterThan(100);
});
