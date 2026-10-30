import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);

async function servedPaths(page: Page, reset = false): Promise<string[]> {
  const response = await page.request.get(`/__served${reset ? "?reset" : ""}`);
  return Object.keys(await response.json());
}

async function openFontsFile(page: Page, fonts: string | null): Promise<string[]> {
  await servedPaths(page, true);
  await page.goto(`/e2e/playground.html?lang=en&src=/fixtures/fonts.pdf${fonts ? `&fonts=${fonts}` : ""}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  await page.waitForTimeout(500);
  return servedPaths(page);
}

test("without a fonts folder the viewer asks for no fonts at all", async ({ page }) => {
  const paths = await openFontsFile(page, null);

  expect(paths.filter((path) => path.startsWith("/fonts/"))).toEqual([]);
});

test("with a fonts folder only the regular faces the document needs are downloaded", async ({ page }) => {
  const paths = await openFontsFile(page, "/fonts/");

  const fonts = paths.filter((path) => path.startsWith("/fonts/")).sort();

  expect(fonts).toEqual(["/fonts/NotoSansJP-Regular.otf", "/fonts/NotoSansKR-Regular.otf"]);
});
