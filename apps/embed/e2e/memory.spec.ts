import { expect, test, type Page } from "@playwright/test";

const OPEN_IMAGE_BUDGET_MB = 40;

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);

function decodedPageImages(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("vive-pdf")?.shadowRoot;
    const images = [...(root?.querySelectorAll<HTMLImageElement>(".vp-page img") ?? [])];
    const firstPage = root?.querySelector('[data-page-index="0"] img');
    return {
      megabytes: images.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight * 4, 0) / 1048576,
      baseWidth: firstPage instanceof HTMLImageElement ? firstPage.naturalWidth : -1,
    };
  });
}

test("page images stay within the memory budget when a document opens", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/book.pdf");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  await page.waitForTimeout(800);

  const images = await decodedPageImages(page);

  expect(images.baseWidth).toBe(595);
  expect(images.megabytes).toBeLessThan(OPEN_IMAGE_BUDGET_MB);
});
