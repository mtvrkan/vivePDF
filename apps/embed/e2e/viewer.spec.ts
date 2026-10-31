import { expect, test, type Page } from "@playwright/test";

const ENGINE_FILES = /\/(viewer\.js|engine-worker\.js|pdfium\.wasm)$/;

async function marks(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
}

async function expectFirstPage(page: Page): Promise<void> {
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  const image = page.getByTestId("viewer").locator('[data-page-index="0"] img').first();
  await expect(image).toBeVisible();
  expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
}

test("a module script tag shows the first page", async ({ page }) => {
  await page.goto("/e2e/module.html");

  await expectFirstPage(page);
});

test("a classic script tag shows the first page", async ({ page }) => {
  await page.goto("/e2e/classic.html");

  await expectFirstPage(page);
});

test("assets from another origin start the engine through a module stub", async ({ page }) => {
  const assetRequests: string[] = [];
  page.on("request", (request) => {
    if (ENGINE_FILES.test(new URL(request.url()).pathname)) assetRequests.push(new URL(request.url()).origin);
  });

  await page.goto("/e2e/cdn.html");

  await expectFirstPage(page);
  expect(assetRequests.length).toBeGreaterThanOrEqual(3);
  expect(new Set(assetRequests)).toEqual(new Set(["http://127.0.0.1:4311"]));
});

test("the assets attribute loads the viewer files from the folder a bundled site copied them to", async ({ page }) => {
  const assetRequests: string[] = [];
  page.on("request", (request) => {
    if (ENGINE_FILES.test(new URL(request.url()).pathname)) assetRequests.push(request.url());
  });

  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/small.pdf&assets=http://127.0.0.1:4311/dist");

  await expectFirstPage(page);
  expect(assetRequests.length).toBeGreaterThanOrEqual(3);
  expect(assetRequests.every((url) => url.startsWith("http://127.0.0.1:4311/dist/"))).toBe(true);
});

test("the engine downloads only when the viewer comes into view", async ({ page }) => {
  const engineRequests: string[] = [];
  page.on("request", (request) => {
    if (ENGINE_FILES.test(new URL(request.url()).pathname)) engineRequests.push(request.url());
  });
  await page.goto("/e2e/lazy.html");
  await page.waitForLoadState("networkidle");
  expect(engineRequests).toEqual([]);

  await page.getByTestId("viewer").scrollIntoViewIfNeeded();

  await expectFirstPage(page);
  expect(engineRequests.length).toBeGreaterThanOrEqual(3);
});

test("a missing file reports an open error instead of hanging", async ({ page }) => {
  await page.goto("/e2e/missing.html");

  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("open-error");
  expect(await marks(page)).not.toContain("first-page");
});
