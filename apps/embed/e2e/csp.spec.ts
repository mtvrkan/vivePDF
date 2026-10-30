import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);

for (const [name, path] of [
  ["from the same site", "/e2e/csp.html"],
  ["from a CDN", "/e2e/csp-cdn.html"],
]) {
  test(`a page with a strict Content Security Policy shows the first page when the viewer comes ${name}`, async ({ page }) => {
    await page.goto(path);

    await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  });
}
